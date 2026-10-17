import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: vi.fn(), send: vi.fn(), start: vi.fn(), close: vi.fn(), intercept: vi.fn(), createCard: vi.fn(), content: vi.fn(), patch: vi.fn(), settings: vi.fn(), update: vi.fn(),
}))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  LoggerLevel: { error: 1 },
  defaultHttpInstance: { create: (options: unknown) => {
    mocks.options(options)
    return { interceptors: { response: { use: mocks.intercept } } }
  } },
  Client: class { cardkit = { v1: { card: { create: mocks.createCard, settings: mocks.settings, update: mocks.update }, cardElement: { content: mocks.content, patch: mocks.patch } } }; im = { v1: { message: { create: mocks.send } } } },
  EventDispatcher: class { register(events: unknown) { return events } },
  WSClient: class { start = mocks.start; close = mocks.close; getConnectionStatus() { return { state: 'connected' } } },
}))
import { createFeishuTransport } from '../../electron/main/feishu/transport'
afterEach(() => vi.clearAllMocks())

it('uses bounded outbound HTTP and aborts it together with the socket', async () => {
  const transport = createFeishuTransport('cli_test', 'secret')
  const receive = vi.fn()
  await transport.start(receive)
  expect(mocks.start).toHaveBeenCalledWith({ eventDispatcher: { 'im.message.receive_v1': receive } })
  const options = mocks.options.mock.calls[0][0]
  expect(options).toMatchObject({ timeout: 15_000, maxRedirects: 0, maxBodyLength: 65536 })
  expect(options.signal.aborted).toBe(false)
  mocks.send.mockResolvedValue({ code: 0 })
  await transport.send('chat', 'answer', 'receipt')
  expect(mocks.send).toHaveBeenCalledWith({ params: { receive_id_type: 'chat_id' }, data: {
    receive_id: 'chat', msg_type: 'interactive', content: expect.any(String), uuid: 'receipt',
  } })
  expect(JSON.parse(mocks.send.mock.calls[0][0].data.content)).toMatchObject({ schema: '2.0', config: { streaming_mode: false } })
  transport.close()
  expect(options.signal.aborted).toBe(true)
  expect(mocks.close).toHaveBeenCalledWith({ force: true })
})

it('does not report an API rejection as successful delivery', async () => {
  mocks.send.mockResolvedValue({ code: 99991672, msg: 'insufficient permissions' })
  await expect(createFeishuTransport('cli_test', 'secret').send('chat', 'answer', 'receipt')).rejects.toThrow('消息发送失败')
})

it('uses Card JSON 2.0, cumulative content updates, collapsed tools and an explicit end to streaming', async () => {
  mocks.createCard.mockResolvedValue({ code: 0, data: { card_id: 'card' } })
  for (const method of [mocks.send, mocks.content, mocks.patch, mocks.settings, mocks.update]) method.mockResolvedValue({ code: 0 })
  const transport = createFeishuTransport('cli_test', 'secret')
  const reply = { text: 'answer', tools: [{ name: 'Read', status: 'done' as const }] }
  expect(await transport.createCard(reply)).toBe('card')
  const card = JSON.parse(mocks.createCard.mock.calls[0][0].data.data)
  expect(card).toMatchObject({ schema: '2.0', config: { streaming_mode: true, update_multi: true } })
  expect(card.body.elements[1]).toMatchObject({ tag: 'collapsible_panel', expanded: false })
  await transport.sendCard('chat', 'card', 'uuid')
  expect(JSON.parse(mocks.send.mock.calls[0][0].data.content)).toEqual({ type: 'card', data: { card_id: 'card' } })
  await transport.updateCard('card', reply, 1, false)
  expect(mocks.content).toHaveBeenCalledWith({ path: { card_id: 'card', element_id: 'answer' }, data: { content: 'answer', sequence: 1 } })
  expect(mocks.patch.mock.calls[0][0].data.sequence).toBe(2)
  await transport.updateCard('card', reply, 3, true)
  expect(JSON.parse(mocks.settings.mock.calls[0][0].data.settings)).toEqual({ config: { streaming_mode: false } })
  expect(mocks.update.mock.calls[0][0].data.sequence).toBe(4)
  expect(JSON.parse(mocks.update.mock.calls[0][0].data.card.data).config.streaming_mode).toBe(false)
  transport.close()
})
