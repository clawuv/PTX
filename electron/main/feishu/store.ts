import type { MobileConversation } from './conversations'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FeishuConfig } from '../../../src/types/feishu'
import { requireRecord, requireString } from '../validation'
import { parseConfig } from './protocol'

export interface FeishuRecord {
  config: FeishuConfig
  secret: string
  enabled: boolean
  seen: { id: string; at: number }[]
  conversation?: MobileConversation
  task: { id: string; chatId: string; notifiedStatus: string } | null
}
export interface FeishuSecretCodec {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
export class FeishuStore {
  constructor(private file: string, private codec: FeishuSecretCodec) {}
  private requireStorage(): void {
    if (!this.codec.available()) throw new Error('无法访问系统安全存储，请解锁钥匙串或配置 GNOME Keyring / KWallet 后重试。')
  }
  load(): FeishuRecord | null {
    if (!existsSync(this.file)) return null
    this.requireStorage()
    if (statSync(this.file).size > 512_000) throw new Error('Feishu configuration exceeds size limit')
    const data = requireRecord(JSON.parse(this.codec.decrypt(readFileSync(this.file))), 'Feishu store')
    if (data.version !== 1 || typeof data.enabled !== 'boolean' || !Array.isArray(data.seen) || data.seen.length > 1000) throw new Error('Invalid Feishu store')
    const task = data.task === null ? null : requireRecord(data.task, 'Feishu task')
    const conversation = data.conversation === undefined ? undefined : requireRecord(data.conversation, 'mobile conversation')
    if (conversation && (!Array.isArray(conversation.delivered) || conversation.delivered.length > 2000)) throw new Error('Invalid reply receipts')
    return {
      ...(conversation ? { conversation: {
        sessionFile: requireString(conversation.sessionFile, 'session path', { min: 1, max: 4096 }),
        sessionId: requireString(conversation.sessionId, 'session ID', { min: 1, max: 200 }),
        chatId: requireString(conversation.chatId, 'chat ID', { min: 1, max: 200 }),
        title: requireString(conversation.title, 'title', { min: 1, max: 200 }),
        ...(conversation.card === undefined ? {} : { card: parseCardReceipt(conversation.card) }),
        delivered: (Array.isArray(conversation.delivered) ? conversation.delivered : []).map((id: unknown) => requireString(id, 'reply ID', { min: 1, max: 200 })),
      } } : {}),
      config: parseConfig(data.config), secret: requireString(data.secret, 'App Secret', { min: 1, max: 512 }), enabled: data.enabled,
      seen: data.seen.map((raw: unknown) => {
        const receipt = requireRecord(raw, 'message receipt')
        if (typeof receipt.at !== 'number' || !Number.isFinite(receipt.at)) throw new Error('Invalid message receipt')
        return { id: requireString(receipt.id, 'message ID', { min: 1, max: 200 }), at: receipt.at }
      }),
      task: task ? {
        id: requireString(task.id, 'task ID', { min: 1, max: 200 }), chatId: requireString(task.chatId, 'chat ID', { min: 1, max: 200 }),
        notifiedStatus: requireString(task.notifiedStatus, 'status', { max: 64 }),
      } : null,
    }
  }
  save(record: FeishuRecord): void {
    this.requireStorage()
    const encrypted = this.codec.encrypt(JSON.stringify({ version: 1, ...record }))
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, encrypted, { mode: 0o600, flag: 'wx' })
      renameSync(temp, this.file)
    } finally { if (existsSync(temp)) unlinkSync(temp) }
  }
  forget(): void { if (existsSync(this.file)) unlinkSync(this.file) }
}

function parseCardReceipt(value: unknown): NonNullable<MobileConversation['card']> {
  const card = requireRecord(value, 'card receipt')
  if (!Number.isSafeInteger(card.sequence) || typeof card.sequence !== 'number' || card.sequence < 0 || typeof card.sent !== 'boolean' || typeof card.finishing !== 'boolean') throw new Error('Invalid card sequence')
  return { id: requireString(card.id, 'card ID', { min: 1, max: 200 }), uuid: requireString(card.uuid, 'card UUID', { min: 1, max: 100 }), sequence: card.sequence, sent: card.sent, finishing: card.finishing }
}
