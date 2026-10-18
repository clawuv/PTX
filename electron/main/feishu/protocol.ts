import type { FeishuConfig } from '../../../src/types/feishu'
import { requireRecord, requireString, rejectUnknownKeys } from '../validation'

export function parseConfig(raw: unknown): FeishuConfig {
  const value = requireRecord(raw, 'Feishu configuration')
  rejectUnknownKeys(value, ['appId', 'allowedOpenId', 'harness', 'projectId', 'model'])
  if (value.harness !== 'pi' && value.harness !== 'omp') throw new TypeError('Choose Pi or OMP')
  const appId = requireString(value.appId, 'App ID', { min: 5, max: 100, trim: true })
  const allowedOpenId = requireString(value.allowedOpenId, 'Open ID', { min: 5, max: 100, trim: true })
  if (!/^cli_[a-zA-Z0-9]+$/.test(appId)) throw new TypeError('Invalid Feishu App ID')
  if (!/^ou_[a-zA-Z0-9_-]+$/.test(allowedOpenId)) throw new TypeError('Use the user Open ID belonging to this application')
  return {
    appId, allowedOpenId, harness: value.harness,
    projectId: requireString(value.projectId, 'project', { min: 1, max: 200 }),
    model: requireString(value.model, 'model', { min: 1, max: 256, trim: true }),
  }
}

export interface FeishuMessage { id: string; chatId: string; text: string; imageKey?: string }

/** Ignore group chats, bots, other identities, old deliveries and anything that is neither text nor an image. */
export function admittedMessage(raw: unknown, openId: string, now = Date.now()): FeishuMessage | null {
  try {
    const event = requireRecord(raw, 'event')
    const sender = requireRecord(event.sender, 'sender')
    const identity = requireRecord(sender.sender_id, 'sender identity')
    const message = requireRecord(event.message, 'message')
    if (sender.sender_type !== 'user' || identity.open_id !== openId || message.chat_type !== 'p2p') return null
    const created = Number(message.create_time)
    if (!Number.isFinite(created) || created > now + 60_000 || now - created > 5 * 60_000) return null
    const content = JSON.parse(requireString(message.content, 'content', { max: 24_000 }))
    const fields = requireRecord(content, 'content')
    const id = requireString(message.message_id, 'message ID', { min: 1, max: 200 })
    const chatId = requireString(message.chat_id, 'chat ID', { min: 1, max: 200 })
    if (message.message_type === 'text') {
      const text = requireString(fields.text, 'text', { min: 1, max: 8_000, trim: true })
      return { id, chatId, text }
    }
    if (message.message_type === 'image') {
      const imageKey = requireString(fields.image_key, 'image_key', { min: 1, max: 200 })
      return { id, chatId, text: '', imageKey }
    }
    if (message.message_type === 'post') {
      const rows = Array.isArray(fields.content) ? fields.content : []
      const images: unknown[] = []
      const texts: string[] = []
      for (const row of rows) {
        if (!Array.isArray(row)) return null
        for (const block of row) {
          const record = requireRecord(block, 'post block')
          if (record.tag === 'img') images.push(record.image_key)
          else if (record.tag === 'text') texts.push(requireString(record.text, 'post text', { min: 1, max: 8_000 }))
        }
      }
      if (images.length !== 1) return null
      const imageKey = requireString(images[0], 'image_key', { min: 1, max: 200 })
      return { id, chatId, text: texts.join('\n').trim(), imageKey }
    }
    return null
  } catch { return null }
}

export type FeishuCommand = { kind: 'message'; prompt: string } | { kind: 'switch'; id: string } | { kind: 'new' | 'sessions' | 'status' | 'stop' | 'result' | 'help' } | { kind: 'sendImage'; path: string }
export function parseCommand(text: string): FeishuCommand {
  if (text === '/新建' || text === '/new') return { kind: 'new' }
  if (text === '/会话' || text === '/sessions') return { kind: 'sessions' }
  if (text.startsWith('/切换 ') || text.startsWith('/switch ')) return { kind: 'switch', id: text.slice(text.indexOf(' ') + 1).trim() }
  if (text === '/状态' || text === '/status') return { kind: 'status' }
  if (text === '/停止' || text === '/stop') return { kind: 'stop' }
  if (text === '/结果' || text === '/result') return { kind: 'result' }
  if (text === '/发图' || text === '/img' || text.startsWith('/发图 ') || text.startsWith('/img ')) {
    const separator = text.indexOf(' ')
    return { kind: 'sendImage', path: separator === -1 ? '' : text.slice(separator + 1).trim() }
  }
  if (text.startsWith('/任务 ') || text.startsWith('/task ')) return { kind: 'message', prompt: text.slice(text.indexOf(' ') + 1).trim() }
  if (text.startsWith('/')) return { kind: 'help' }
  return { kind: 'message', prompt: text }
}
