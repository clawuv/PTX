import { cardJson, toolPanel, boundedCardText, type ReplyCard } from './cards'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
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
  sendImage(chatId: string, filePath: string, uuid: string): Promise<void>
  downloadImage(messageId: string, fileKey: string): Promise<Buffer>
}

export function createFeishuTransport(appId: string, appSecret: string): FeishuTransport {
  // SDK errors can carry request configuration. Never log credentials or message payloads.
  const logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} }
  const controller = new AbortController()
  // Card and text traffic stays on the tight JSON budget; image upload (multipart)
  // and download (binary) need a second bounded instance sized for Feishu's 10MB
  // image ceiling plus encoding headroom. Axios enforces maxBodyLength on streamed
  // uploads, so a 64KB body cap would reject nearly every real image.
  const jsonHttp = defaultHttpInstance.create({ timeout: 15_000, maxContentLength: 2 * 1024 * 1024, maxBodyLength: 64 * 1024, maxRedirects: 0, signal: controller.signal })
  const imageHttp = defaultHttpInstance.create({ timeout: 60_000, maxContentLength: 12 * 1024 * 1024, maxBodyLength: 12 * 1024 * 1024, maxRedirects: 0, signal: controller.signal })
  const wrap = (http: ReturnType<typeof defaultHttpInstance.create>, forced: { responseType?: 'json' } = {}): HttpInstance => {
    async function request<T = unknown, R = T, D = unknown>(options: HttpRequestOptions<D>): Promise<R> {
      const response = await http.request<R>({ ...options, ...forced })
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
    return httpInstance
  }
  const options = { httpInstance: wrap(jsonHttp, { responseType: 'json' }), appId, appSecret, logger, loggerLevel: LoggerLevel.error }
  const client = new Client(options)
  // Both clients share the SDK's module-level token cache, so only one token is fetched.
  const media = new Client({ ...options, httpInstance: wrap(imageHttp) })
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
    sendImage: async (chatId, filePath, uuid) => {
      const info = await stat(filePath).catch(() => { throw new Error('找不到要发送的图片文件，请确认电脑上的路径。') })
      if (!info.isFile() || info.size === 0 || info.size > 10 * 1024 * 1024) throw new Error('图片无效或超过飞书 10MB 上限。')
      const image = createReadStream(filePath)
      // Real uploads consume the stream through the SDK; the no-op error handler keeps an
      // unconsumed stream from surfacing late open failures as uncaught exceptions.
      image.on('error', () => {})
      let imageKey: string | undefined
      try {
        imageKey = (await media.im.v1.image.create({ data: { image_type: 'message', image } }))?.image_key
      } catch (error) {
        const data = (error as { response?: { data?: unknown } })?.response?.data
        console.warn('[feishu] image upload failed:', typeof data === 'string' ? data.slice(0, 200) : data ?? error)
        throw new Error('图片上传失败，请确认飞书应用已开通 im:resource（上传图片）权限。')
      } finally {
        // The SDK may not consume the stream on rejection; destroy it so a pending open cannot emit after cleanup.
        image.destroy()
      }
      if (!imageKey) throw new Error('图片上传失败，请确认飞书应用已开通 im:resource（上传图片）权限。')
      try {
        check(await client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: {
          receive_id: chatId, msg_type: 'image', content: JSON.stringify({ image_key: imageKey }), uuid,
        } }))
      } catch (error) {
        const data = (error as { response?: { data?: unknown } })?.response?.data
        console.warn('[feishu] image message send failed:', typeof data === 'string' ? data.slice(0, 200) : data ?? error)
        throw new Error('图片消息发送失败，请检查机器人发送权限和网络。')
      }
    },
    downloadImage: async (messageId, fileKey) => {
      // client.request returns the response body directly (the httpInstance wrapper
      // already unwraps the axios envelope), so the ArrayBuffer body is consumed as-is.
      let body: unknown
      try {
        body = await media.request({
          url: `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}`,
          method: 'GET',
          params: { type: 'image' },
          responseType: 'arraybuffer',
        })
      } catch (error) {
        const data = (error as { response?: { data?: unknown } })?.response?.data
        console.warn('[feishu] image download failed:', typeof data === 'string' ? data.slice(0, 200) : data ?? error)
        throw new Error('图片下载失败，请确认飞书应用已开通读取消息（im:message:readonly）权限。')
      }
      const buffer = body instanceof Uint8Array ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
        : body instanceof ArrayBuffer ? Buffer.from(body)
        : undefined
      if (!buffer?.length) throw new Error('图片下载失败，请确认飞书应用已开通读取消息（im:message:readonly）权限。')
      return buffer
    },
  }
}
