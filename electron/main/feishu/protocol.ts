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

export interface FeishuMessage { id: string; chatId: string; text: string }

/** Ignore group chats, bots, other identities, old deliveries and non-text messages. */
export function admittedMessage(raw: unknown, openId: string, now = Date.now()): FeishuMessage | null {
  try {
    const event = requireRecord(raw, 'event')
    const sender = requireRecord(event.sender, 'sender')
    const identity = requireRecord(sender.sender_id, 'sender identity')
    const message = requireRecord(event.message, 'message')
    if (sender.sender_type !== 'user' || identity.open_id !== openId || message.chat_type !== 'p2p' || message.message_type !== 'text') return null
    const created = Number(message.create_time)
    if (!Number.isFinite(created) || created > now + 60_000 || now - created > 5 * 60_000) return null
    const content = JSON.parse(requireString(message.content, 'content', { max: 24_000 }))
    const text = requireString(requireRecord(content, 'content').text, 'text', { min: 1, max: 8_000, trim: true })
    return {
      id: requireString(message.message_id, 'message ID', { min: 1, max: 200 }),
      chatId: requireString(message.chat_id, 'chat ID', { min: 1, max: 200 }), text,
    }
  } catch { return null }
}

export type FeishuCommand = { kind: 'message'; prompt: string } | { kind: 'switch'; id: string } | { kind: 'new' | 'sessions' | 'status' | 'stop' | 'result' | 'help' }
export function parseCommand(text: string): FeishuCommand {
  if (text === '/新建' || text === '/new') return { kind: 'new' }
  if (text === '/会话' || text === '/sessions') return { kind: 'sessions' }
  if (text.startsWith('/切换 ') || text.startsWith('/switch ')) return { kind: 'switch', id: text.slice(text.indexOf(' ') + 1).trim() }
  if (text === '/状态' || text === '/status') return { kind: 'status' }
  if (text === '/停止' || text === '/stop') return { kind: 'stop' }
  if (text === '/结果' || text === '/result') return { kind: 'result' }
  if (text.startsWith('/任务 ') || text.startsWith('/task ')) return { kind: 'message', prompt: text.slice(text.indexOf(' ') + 1).trim() }
  if (text.startsWith('/')) return { kind: 'help' }
  return { kind: 'message', prompt: text }
}
