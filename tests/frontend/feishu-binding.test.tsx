// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FeishuBindingDialog } from '../../src/pages/settings/FeishuBindingDialog'
import type { FeishuBindingState } from '../../src/types/feishu'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let state: FeishuBindingState
const finish = vi.fn()
const cancel = vi.fn(async () => ({ phase: 'idle' }))
beforeEach(() => {
  vi.useFakeTimers()
  state = { phase: 'waiting', image: 'data:image/png;base64,test', expiresAt: Date.now() + 60_000 }
  Object.defineProperty(window, 'ptx', { configurable: true, value: { feishu: {
    beginBinding: vi.fn(async () => state), bindingStatus: vi.fn(async () => state), cancelBinding: cancel, finishBinding: finish,
  } } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks() })

it('opens the QR automatically, receives authorization, and saves only the selected execution target', async () => {
  const onBound = vi.fn()
  const onClose = vi.fn()
  const target = { harness: 'pi' as const, projectId: 'project', model: 'provider/model' }
  await act(async () => root.render(<FeishuBindingDialog target={target} targetFields={<span>Project</span>} onBound={onBound} onClose={onClose} />))
  expect(document.querySelector('img')?.getAttribute('alt')).toContain('授权二维码')
  state = { phase: 'authorized', appId: 'cli_new', openId: 'ou_owner' }
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(document.body.textContent).toContain('扫码授权成功')
  finish.mockResolvedValue({ config: { ...target, appId: 'cli_new', allowedOpenId: 'ou_owner' }, hasSecret: true, enabled: false, connection: 'idle' })
  const save = [...document.querySelectorAll('button')].find((button) => button.textContent === '保存绑定')!
  await act(async () => save.click())
  expect(finish).toHaveBeenCalledWith(target)
  expect(onBound).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})

it('prevents binding before choosing a project and cancels registration when the dialog closes', async () => {
  state = { phase: 'authorized', appId: 'cli_new', openId: 'ou_owner' }
  await act(async () => root.render(<FeishuBindingDialog target={{ harness: 'pi', projectId: '', model: '' }} targetFields={null} onBound={vi.fn()} onClose={vi.fn()} />))
  expect([...document.querySelectorAll('button')].find((button) => button.textContent === '保存绑定')?.disabled).toBe(true)
  await act(async () => root.render(null))
  expect(cancel).toHaveBeenCalled()
  expect(finish).not.toHaveBeenCalled()
})
