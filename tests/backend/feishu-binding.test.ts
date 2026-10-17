import { afterEach, expect, it, vi } from 'vitest'
import { FeishuBinding } from '../../electron/main/feishu/binding'
import type { registerApp } from '@larksuiteoapi/node-sdk'

const active: FeishuBinding[] = []
afterEach(() => { active.forEach((binding) => { binding.cancel() }); active.length = 0; vi.useRealTimers() })
function fixture() {
  let options: Parameters<typeof registerApp>[0] | undefined
  let resolve: (value: Awaited<ReturnType<typeof registerApp>>) => void = () => {}
  const register = vi.fn((input: Parameters<typeof registerApp>[0]) => {
    options = input
    return new Promise<Awaited<ReturnType<typeof registerApp>>>((done) => { resolve = done })
  })
  const binding = new FeishuBinding(register)
  active.push(binding)
  binding.begin()
  return { binding, register, options: () => options!, resolve: (value: Awaited<ReturnType<typeof registerApp>>) => resolve(value) }
}

it('requests a new bot with explicit messaging permissions and never exposes the returned secret', async () => {
  const f = fixture()
  expect(f.options()).toMatchObject({ createOnly: true, addons: { preset: false, events: { items: { tenant: ['im.message.receive_v1'] } } } })
  f.resolve({ client_id: 'cli_test', client_secret: 'secret', user_info: { open_id: 'ou_owner' } })
  await vi.waitFor(() => expect(f.binding.status().phase).toBe('authorized'))
  expect(JSON.stringify(f.binding.status())).not.toContain('secret')
  expect(f.binding.requireCredentials()).toEqual({ appId: 'cli_test', secret: 'secret', openId: 'ou_owner' })
  f.binding.cancel()
  expect(() => f.binding.requireCredentials()).toThrow('扫码')
})

it('renders an official authorization URL as a local PNG QR code', async () => {
  const f = fixture()
  f.options().onQRCodeReady({ url: 'https://accounts.feishu.cn/device?user_code=test', expireIn: 120 })
  await vi.waitFor(() => expect(f.binding.status()).toMatchObject({ phase: 'waiting', image: expect.stringMatching(/^data:image\/png;base64,/) }))
})

it('rejects unexpected QR hosts and late results after cancellation', async () => {
  const f = fixture()
  f.options().onQRCodeReady({ url: 'https://example.com/scan', expireIn: 120 })
  await vi.waitFor(() => expect(f.binding.status().phase).toBe('error'))
  expect(f.options().signal?.aborted).toBe(true)
  f.resolve({ client_id: 'cli_test', client_secret: 'secret', user_info: { open_id: 'ou_owner' } })
  await Promise.resolve()
  expect(() => f.binding.requireCredentials()).toThrow()
})

it('rejects incomplete identity rather than binding an unknown scanner', async () => {
  const f = fixture()
  f.resolve({ client_id: 'cli_test', client_secret: 'secret' })
  await vi.waitFor(() => expect(f.binding.status().phase).toBe('error'))
  expect(() => f.binding.requireCredentials()).toThrow()
})

it('expires unused credentials and ignores the previous attempt after restarting', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const oldSignal = f.options().signal
  const oldResolve = f.resolve
  f.binding.cancel()
  expect(oldSignal?.aborted).toBe(true)
  oldResolve({ client_id: 'cli_old', client_secret: 'old', user_info: { open_id: 'ou_owner' } })
  await Promise.resolve()
  expect(f.binding.status().phase).toBe('idle')
  f.binding.begin()
  f.resolve({ client_id: 'cli_new', client_secret: 'new', user_info: { open_id: 'ou_owner' } })
  await Promise.resolve()
  expect(f.binding.status().phase).toBe('authorized')
  await vi.advanceTimersByTimeAsync(600_000)
  expect(f.binding.status().phase).toBe('error')
  expect(() => f.binding.requireCredentials()).toThrow()
})
