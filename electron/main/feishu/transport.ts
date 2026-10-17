import { cardJson, toolPanel, boundedCardText, type ReplyCard } from './cards'
import { Client, defaultHttpInstance, EventDispatcher, LoggerLevel, WSClient, type HttpInstance, type HttpRequestOptions } from '@larksuiteoapi/node-sdk'
import type { FeishuStatus } from '../../../src/types/feishu'

export interface FeishuTransport {
  start(receive: (event: unknown) => Promise<void>): Promise<void>
  close(): void
  state(): FeishuStatus['connection']
  createCard(reply: ReplyCard): Promise<string>
  sendCard(chatId: string, cardId: string, uuid: string): Promise<void>
  updateCard(cardId: string, reply: ReplyCard, sequence: number, done: boolean): Promise<void>
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
  const check = (result: { code?: number }) => {
    if (result.code !== 0) throw new Error('飞书卡片操作失败，请检查 cardkit:card:write、机器人发送权限和网络。')
  }
  return {
    createCard: async (reply) => {
      const result = await client.cardkit.v1.card.create({ data: { type: 'card_json', data: JSON.stringify(cardJson(reply, true)) } })
      check(result)
      if (!result.data?.card_id) throw new Error('飞书未返回卡片 ID')
      return result.data.card_id
    },
    sendCard: async (chatId, cardId, uuid) => {
      check(await client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: {
        receive_id: chatId, msg_type: 'interactive', content: JSON.stringify({ type: 'card', data: { card_id: cardId } }), uuid,
      } }))
    },
    updateCard: async (cardId, reply, sequence, done) => {
      const path = { card_id: cardId }
      if (done) {
        check(await client.cardkit.v1.card.settings({ path, data: { settings: JSON.stringify({ config: { streaming_mode: false } }), sequence } }))
        check(await client.cardkit.v1.card.update({ path, data: { card: { type: 'card_json', data: JSON.stringify(cardJson(reply, false)) }, sequence: sequence + 1 } }))
      } else {
        check(await client.cardkit.v1.cardElement.content({ path: { ...path, element_id: 'answer' },
          data: { content: boundedCardText(reply.text) || '正在处理…', sequence } }))
        const { tag: _tag, element_id: _id, ...panel } = toolPanel(reply.tools)
        check(await client.cardkit.v1.cardElement.patch({ path: { ...path, element_id: 'tools' },
          data: { partial_element: JSON.stringify(panel), sequence: sequence + 1 } }))
      }
    },
    start: async (receive) => {
      await ws.start({ eventDispatcher: new EventDispatcher({ logger }).register({ 'im.message.receive_v1': receive }) })
    },
    close: () => { controller.abort(); ws.close({ force: true }) },
    state: () => ws.getConnectionStatus().state,
    send: async (chatId, text, uuid) => {
      const result = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(cardJson({ text, tools: [] }, false)), uuid },
      })
      if (result?.code !== 0) throw new Error('飞书消息发送失败，请检查机器人权限及网络。')
    },
  }
}
