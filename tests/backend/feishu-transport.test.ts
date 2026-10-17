import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: vi.fn(), send: vi.fn(), start: vi.fn(), close: vi.fn(), intercept: vi.fn(),
}))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  LoggerLevel: { error: 1 },
  defaultHttpInstance: { create: (options: unknown) => {
    mocks.options(options)
    return { interceptors: { response: { use: mocks.intercept } } }
  } },
  Client: class { im = { v1: { message: { create: mocks.send } } } },
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
    receive_id: 'chat', msg_type: 'text', content: '{"text":"answer"}', uuid: 'receipt',
  } })
  transport.close()
  expect(options.signal.aborted).toBe(true)
  expect(mocks.close).toHaveBeenCalledWith({ force: true })
})

it('does not report an API rejection as successful delivery', async () => {
  mocks.send.mockResolvedValue({ code: 99991672, msg: 'insufficient permissions' })
  await expect(createFeishuTransport('cli_test', 'secret').send('chat', 'answer', 'receipt')).rejects.toThrow('消息发送失败')
})
