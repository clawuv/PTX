// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateButton } from '../../src/components/AppUpdateButton'
import type { AppUpdateState } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})


async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function renderSidebar(updateState: AppUpdateState, onUpdateAction: () => void) {
  await act(async () => {
    root.render(
      <AppUpdateButton updateState={updateState} onUpdateAction={onUpdateAction} />,
    )
  })
}

describe('sidebar update control', () => {
  it.each(['idle', 'checking', 'not-available', 'unsupported', 'error'] as const)('hides the update button when no update is known in %s', async (phase) => {
    await renderSidebar({ phase }, vi.fn())
    expect(container.querySelector('.app-update')).toBeNull()
  })

  it('asks only about restarting when the update is already downloaded', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloaded', version: '0.2.0' }, onUpdateAction)

    await press(container.querySelector('.app-update')!)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Restart Ptx to install the update?')
    expect(dialog?.textContent).toContain('close and restart')
    expect(dialog?.textContent).not.toContain('download the update')

    const yes = [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Yes')
    await press(yes!)
    expect(onUpdateAction).toHaveBeenCalledOnce()
  })

  it('keeps a retry affordance and the version after a failed download', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'error', version: '0.2.0', message: 'network went away' }, onUpdateAction)

    const update = container.querySelector<HTMLButtonElement>('.app-update')
    expect(update).not.toBeNull()
    expect(update?.classList.contains('app-update--error')).toBe(true)
    expect(update?.textContent).toContain('Retry update 0.2.0')
    expect(update?.getAttribute('title')).toBe('network went away')
    expect(update?.disabled).toBe(false)

    // Retrying re-checks straight away instead of asking to download and restart.
    await press(update!)
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onUpdateAction).toHaveBeenCalledOnce()
  })

  it('shows a busy state instead of a stuck 0% until progress is known', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloading', version: '0.2.0' }, onUpdateAction)

    const update = container.querySelector('.app-update')
    expect(update?.textContent).toContain('Downloading 0.2.0')
    expect(update?.textContent).not.toContain('%')
    expect(update?.classList.contains('app-update--indeterminate')).toBe(true)

    await renderSidebar({ phase: 'downloading', version: '0.2.0', percent: 12 }, onUpdateAction)
    const progressing = container.querySelector('.app-update')
    expect(progressing?.textContent).toContain('Downloading 0.2.0 · 12%')
    expect(progressing?.classList.contains('app-update--indeterminate')).toBe(false)
  })

  it('announces phase changes from a dedicated status element without the percentage', async () => {
    const onUpdateAction = vi.fn()
    await renderSidebar({ phase: 'downloading', version: '0.2.0', percent: 42 }, onUpdateAction)

    const update = container.querySelector('.app-update')
    expect(update?.getAttribute('aria-live')).toBeNull()
    const status = container.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.textContent).toBe('Downloading Ptx update 0.2.0')
  })
})

describe('unsigned test update control', () => {
  it('explains manual installation without promising an automatic restart', async () => {
    const action = vi.fn()
    await renderSidebar({ phase: 'available', version: '1.0.1', manualInstall: true }, action)
    await press(container.querySelector('.app-update')!)
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('requires manual installation')
    const yes = [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Yes')
    await press(yes!)
    expect(action).toHaveBeenCalledOnce()
  })
})

it('shows an automatically discovered update without starting installation', async () => {
  const action = vi.fn()
  await renderSidebar({ phase: 'checking' }, action)
  expect(container.querySelector('.app-update')).toBeNull()
  await renderSidebar({ phase: 'available', version: '1.0.1' }, action)
  expect(container.querySelector('.app-update')).not.toBeNull()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(action).not.toHaveBeenCalled()
  await press(container.querySelector('.app-update')!)
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  expect(action).not.toHaveBeenCalled()
})
