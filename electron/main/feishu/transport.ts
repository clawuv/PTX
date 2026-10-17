import { Client, defaultHttpInstance, EventDispatcher, LoggerLevel, WSClient, type HttpInstance, type HttpRequestOptions } from '@larksuiteoapi/node-sdk'
import type { FeishuStatus } from '../../../src/types/feishu'

export interface FeishuTransport {
  start(receive: (event: unknown) => Promise<void>): Promise<void>
  close(): void
  state(): FeishuStatus['connection']
  send(chatId: string, text: string, uuid: string): Promise<void>
}

export function createFeishuTransport(appId: string, appSecret: string): FeishuTransport {
  // SDK errors can carry request configuration. Never log credentials or message payloads.
  const logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} }
  const controller = new AbortController()
  const http = defaultHttpInstance.create({ timeout: 15_000, maxContentLength: 2 * 1024 * 1024, maxBodyLength: 64 * 1024, maxRedirects: 0, signal: controller.signal })
  async function request<T = unknown, R = T, D = unknown>(options: HttpRequestOptions<D>): Promise<R> {
    const response = await http.request<R>({ ...options, responseType: 'json' })
    return response.data
  }
  const httpInstance: HttpInstance = {
    request,
    get: (url, options) => request({ ...options, url, method: 'GET' }),
    delete: (url, options) => request({ ...options, url, method: 'DELETE' }),
    head: (url, options) => request({ ...options, url, method: 'HEAD' }),
    options: (url, options) => request({ ...options, url, method: 'OPTIONS' }),
    post: (url, data, options) => request({ ...options, url, data, method: 'POST' }),
    put: (url, data, options) => request({ ...options, url, data, method: 'PUT' }),
    patch: (url, data, options) => request({ ...options, url, data, method: 'PATCH' }),
  }
  const options = { httpInstance, appId, appSecret, logger, loggerLevel: LoggerLevel.error }
  const client = new Client(options)
  const ws = new WSClient({ ...options, handshakeTimeoutMs: 15_000 })
  return {
    start: async (receive) => {
      await ws.start({ eventDispatcher: new EventDispatcher({ logger }).register({ 'im.message.receive_v1': receive }) })
    },
    close: () => { controller.abort(); ws.close({ force: true }) },
    state: () => ws.getConnectionStatus().state,
    send: async (chatId, text, uuid) => {
      const result = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: text.slice(0, 12_000) }), uuid },
      })
      if (result?.code !== 0) throw new Error('飞书消息发送失败，请检查机器人权限及网络。')
    },
  }
}
