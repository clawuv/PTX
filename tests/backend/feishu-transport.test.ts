import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  options: vi.fn(), axios: vi.fn(), start: vi.fn(), close: vi.fn(), intercept: vi.fn(),
}))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  LoggerLevel: { error: 1 },
  defaultHttpInstance: { create: (config: unknown) => {
    mocks.options(config)
    return {
      request: (payload: unknown) => mocks.axios(payload, config),
      interceptors: { response: { use: mocks.intercept } },
    }
  } },
  // Mirrors the real SDK contract: every API method funnels through the injected
  // httpInstance, which returns the response body directly, so tests exercise the
  // transport's own axios wrappers (bounds, responseType handling) for real.
  Client: class {
    httpInstance: { request: (payload: unknown) => Promise<unknown> }
    constructor(options: { httpInstance: { request: (payload: unknown) => Promise<unknown> } }) {
      this.httpInstance = options.httpInstance
    }
    request(payload: Record<string, unknown>) { return this.httpInstance.request(payload) }
    private forward(payload: Record<string, unknown>, method: string) { return this.httpInstance.request({ ...payload, method }) }
    cardkit = { v1: { card: {
      create: (payload: Record<string, unknown>) => this.forward(payload, 'POST'),
      settings: (payload: Record<string, unknown>) => this.forward(payload, 'PATCH'),
      update: (payload: Record<string, unknown>) => this.forward(payload, 'PUT'),
    }, cardElement: {
      content: (payload: Record<string, unknown>) => this.forward(payload, 'PUT'),
      patch: (payload: Record<string, unknown>) => this.forward(payload, 'PATCH'),
    } } }
    im = { v1: {
      image: { create: (payload: Record<string, unknown>) => this.httpInstance.request({ url: '/im/v1/images', method: 'POST', ...payload, headers: { 'Content-Type': 'multipart/form-data' } })
        .then((res) => (res as { data?: unknown } | null | undefined)?.data ?? null) },
      message: { create: (payload: Record<string, unknown>) => this.forward(payload, 'POST') },
    } }
  },
  EventDispatcher: class { register(events: unknown) { return events } },
  WSClient: class { start = mocks.start; close = mocks.close; getConnectionStatus() { return { state: 'connected' } } },
}))
import { createFeishuTransport } from '../../electron/main/feishu/transport'
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ptx-feishu-transport-'))
  mocks.axios.mockImplementation(async () => ({ data: { code: 0, data: {} } }))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.clearAllMocks() })

it('uses bounded outbound HTTP and aborts both clients together with the socket', async () => {
  const transport = createFeishuTransport('cli_test', 'secret')
  const receive = vi.fn()
  await transport.start(receive)
  expect(mocks.start).toHaveBeenCalledWith({ eventDispatcher: { 'im.message.receive_v1': receive } })
  const [jsonConfig, imageConfig] = mocks.options.mock.calls.map(([config]) => config)
  expect(jsonConfig).toMatchObject({ timeout: 15_000, maxRedirects: 0, maxBodyLength: 64 * 1024 })
  expect(imageConfig).toMatchObject({ timeout: 60_000, maxRedirects: 0, maxBodyLength: 12 * 1024 * 1024, maxContentLength: 12 * 1024 * 1024 })
  expect(jsonConfig.signal.aborted).toBe(false)
  expect(imageConfig.signal.aborted).toBe(false)
  await transport.send('chat', 'answer', 'receipt')
  expect(mocks.axios).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', data: expect.objectContaining({ receive_id: 'chat', uuid: 'receipt' }) }), jsonConfig)
  expect(JSON.parse(mocks.axios.mock.calls[0][0].data.content)).toMatchObject({ schema: '2.0', config: { streaming_mode: false } })
  transport.close()
  expect(jsonConfig.signal.aborted).toBe(true)
  expect(imageConfig.signal.aborted).toBe(true)
  expect(mocks.close).toHaveBeenCalledWith({ force: true })
})

it('does not report an API rejection as successful delivery', async () => {
  mocks.axios.mockResolvedValueOnce({ data: { code: 99991672, msg: 'insufficient permissions' } })
  await expect(createFeishuTransport('cli_test', 'secret').send('chat', 'answer', 'receipt')).rejects.toThrow('消息发送失败')
})

it('uses Card JSON 2.0, cumulative content updates, collapsed tools and an explicit end to streaming', async () => {
  mocks.axios.mockResolvedValueOnce({ data: { code: 0, data: { card_id: 'card' } } })
  const transport = createFeishuTransport('cli_test', 'secret')
  const reply = { text: 'answer', tools: [{ name: 'Read', status: 'done' as const }] }
  expect(await transport.createCard(reply)).toBe('card')
  const card = JSON.parse(mocks.axios.mock.calls[0][0].data.data)
  expect(card).toMatchObject({ schema: '2.0', config: { streaming_mode: true, update_multi: true } })
  expect(card.body.elements[1]).toMatchObject({ tag: 'collapsible_panel', expanded: false })
  await transport.sendCard('chat', 'card', 'uuid')
  expect(JSON.parse(mocks.axios.mock.calls[1][0].data.content)).toEqual({ type: 'card', data: { card_id: 'card' } })
  await transport.updateCard('card', reply, 1, false)
  expect(mocks.axios.mock.calls[2][0].data).toMatchObject({ content: 'answer', sequence: 1 })
  expect(mocks.axios.mock.calls[3][0].data.sequence).toBe(2)
  await transport.updateCard('card', reply, 3, true)
  expect(JSON.parse(mocks.axios.mock.calls[4][0].data.settings)).toEqual({ config: { streaming_mode: false } })
  expect(mocks.axios.mock.calls[5][0].data.sequence).toBe(4)
  expect(JSON.parse(mocks.axios.mock.calls[5][0].data.card.data).config.streaming_mode).toBe(false)
  transport.close()
})

it('uploads local images over the binary-bounded client and sends them as image messages', async () => {
  const file = join(root, 'shot.png')
  writeFileSync(file, 'png')
  mocks.axios.mockResolvedValueOnce({ data: { code: 0, data: { image_key: 'img_v2_key' } } })
    .mockResolvedValueOnce({ data: { code: 0 } })
  await createFeishuTransport('cli_test', 'secret').sendImage('chat', file, 'receipt')
  expect(mocks.axios.mock.calls[0][0]).toMatchObject({ url: '/im/v1/images', method: 'POST', data: { image_type: 'message', image: expect.anything() } })
  expect(mocks.axios.mock.calls[0][1]).toMatchObject({ maxBodyLength: 12 * 1024 * 1024, maxContentLength: 12 * 1024 * 1024 })
  expect(mocks.axios.mock.calls[1][0]).toMatchObject({ params: { receive_id_type: 'chat_id' }, data: {
    receive_id: 'chat', msg_type: 'image', content: JSON.stringify({ image_key: 'img_v2_key' }), uuid: 'receipt',
  } })
  expect(mocks.axios.mock.calls[1][1]).toMatchObject({ maxBodyLength: 64 * 1024 })
})

it('points at the im:resource permission when the upload is rejected', async () => {
  const file = join(root, 'shot.png')
  writeFileSync(file, 'png')
  mocks.axios.mockResolvedValueOnce({ data: { code: 99991672, msg: 'insufficient permissions' } })
  await expect(createFeishuTransport('cli_test', 'secret').sendImage('chat', file, 'receipt')).rejects.toThrow('im:resource')
  expect(mocks.axios).toHaveBeenCalledTimes(1)
})

it('rejects missing or oversized files before uploading', async () => {
  await expect(createFeishuTransport('cli_test', 'secret').sendImage('chat', join(root, 'missing.png'), 'receipt')).rejects.toThrow('找不到')
  const huge = join(root, 'huge.png')
  writeFileSync(huge, Buffer.alloc(10 * 1024 * 1024 + 1))
  await expect(createFeishuTransport('cli_test', 'secret').sendImage('chat', huge, 'receipt')).rejects.toThrow('10MB')
  expect(mocks.axios).not.toHaveBeenCalled()
})

it('downloads image resources as arraybuffer over the binary-bounded client', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  mocks.axios.mockResolvedValueOnce({ data: bytes.buffer })
  const buffer = await createFeishuTransport('cli_test', 'secret').downloadImage('om_x', 'img_v2_key')
  expect(mocks.axios.mock.calls[0][0]).toMatchObject({
    url: '/open-apis/im/v1/messages/om_x/resources/img_v2_key',
    method: 'GET',
    params: { type: 'image' },
    responseType: 'arraybuffer',
  })
  expect(mocks.axios.mock.calls[0][1]).toMatchObject({ maxContentLength: 12 * 1024 * 1024 })
  expect(buffer).toEqual(Buffer.from(bytes))
  expect(buffer.length).toBeGreaterThan(0)
})

it('encodes message and resource identifiers into the download path', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  mocks.axios.mockResolvedValueOnce({ data: bytes.buffer })
  await createFeishuTransport('cli_test', 'secret').downloadImage('om a/b', 'k&y')
  expect(mocks.axios.mock.calls[0][0].url).toBe('/open-apis/im/v1/messages/om%20a%2Fb/resources/k%26y')
})

it('rejects empty downloads with a permission hint', async () => {
  mocks.axios.mockResolvedValueOnce({ data: new ArrayBuffer(0) })
  await expect(createFeishuTransport('cli_test', 'secret').downloadImage('om_x', 'img_v2_key')).rejects.toThrow('im:message:readonly')
})

it('reports download transport failures as a permission hint instead of raw axios errors', async () => {
  mocks.axios.mockRejectedValueOnce(new Error('maxContentLength size of 12582912 exceeded'))
  await expect(createFeishuTransport('cli_test', 'secret').downloadImage('om_x', 'img_v2_key')).rejects.toThrow('im:message:readonly')
})
