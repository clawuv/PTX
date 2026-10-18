// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationHeader } from '../../src/components/ConversationHeader'
import type { GitWorktree, OpenWithTargetId } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const worktrees: GitWorktree[] = [
  { path: '/repo', name: 'repo', branch: 'main', head: 'abc123', current: true, detached: false },
  { path: '/repo-feature', name: 'repo-feature', branch: 'feature/picker', head: 'def456', current: false, detached: false },
]

const session = {
  id: 'session',
  harness: 'omp' as const,
  filePath: '/sessions/session.jsonl',
  projectPath: '/repo',
  title: '分析项目结构与代码',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'idle' as const,
  depth: 0,
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    session,
    worktrees,
    activeWorktreePath: '/repo',
    checkoutLabel: 'main',
    worktreesLoading: false,
    onOpenWorktree: vi.fn(),
    ...overrides,
  }
}

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('conversation header', () => {
  let root: Root
  let container: HTMLDivElement

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

  it('renders the active session title', async () => {
    await act(async () => {
      root.render(<ConversationHeader {...props()} />)
    })
    expect(container.querySelector('.conversation-header__title')?.textContent).toBe('分析项目结构与代码')
    // Without a session the whole title row stays hidden (the new-session state shows no header).
    await act(async () => {
      root.render(<ConversationHeader {...props({ session: undefined })} />)
    })
    expect(container.querySelector('.conversation-header__title')).toBeNull()
  })

  it('marks the body while open so drag-region clicks can dismiss the popover', async () => {
    await act(async () => {
      root.render(<ConversationHeader {...props()} />)
    })

    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    expect(container.querySelector('.summary-popover')).not.toBeNull()
    expect(document.body.classList.contains('has-header-popover')).toBe(true)

    // The header is a drag region: without the body class its mouse events are
    // swallowed by the OS and an outside click never reaches this listener.
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(container.querySelector('.summary-popover')).toBeNull()
    expect(document.body.classList.contains('has-header-popover')).toBe(false)
  })

  it('lists local branches inside the checkout panel and switches from there', async () => {
    const onSwitchBranch = vi.fn(async () => undefined)
    const onBranches = vi.fn(async () => ['main', 'feature/next'])
    await act(async () => {
      root.render(<ConversationHeader {...props({ checkoutLabel: 'main', onBranches, onSwitchBranch })} />)
    })

    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    await press(container.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')!)
    expect(onBranches).toHaveBeenCalledOnce()

    const headings = [...container.querySelectorAll('.worktree-picker__heading')].map((node) => node.textContent)
    expect(headings).toEqual(['Switch branch'])
    const branchOption = [...container.querySelectorAll('[role="menuitemradio"]')].find((button) => button.textContent?.includes('feature/next'))!
    expect(branchOption).not.toBeNull()
    expect(branchOption.getAttribute('aria-checked')).toBe('false')

    await press(branchOption)
    expect(onSwitchBranch).toHaveBeenCalledWith('feature/next')
    // A finished switch collapses the whole popover.
    expect(container.querySelector('.summary-popover')).toBeNull()
  })

  it('offers open-with targets from the summary popover environment section', async () => {
    const onOpenWith = vi.fn()
    const onOpenWithTargets = vi.fn(async () => ['explorer', 'vscode'] as OpenWithTargetId[])
    await act(async () => {
      root.render(<ConversationHeader {...props({ onOpenWithTargets, onOpenWith })} />)
    })

    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    expect(container.querySelector('.summary-popover')).not.toBeNull()
    await press([...container.querySelectorAll('.summary-popover button')].find((button) => button.textContent?.includes('Open with'))!)
    expect(onOpenWithTargets).toHaveBeenCalledOnce()

    const list = container.querySelector('[role="menu"][aria-label="Open with"]')!
    expect(list).not.toBeNull()
    const labels = [...list.querySelectorAll('button')].map((button) => button.textContent?.trim())
    expect(labels).toEqual(['File explorer', 'VS Code'])

    await press([...list.querySelectorAll('button')].find((button) => button.textContent?.includes('VS Code'))!)
    expect(onOpenWith).toHaveBeenCalledWith('vscode')
    // Choosing a target dismisses the whole popover.
    expect(container.querySelector('.summary-popover')).toBeNull()
  })

  it('shows the checkout name instead of a generic Workspace label before the catalog loads', async () => {
    await act(async () => {
      root.render(<ConversationHeader {...props({ worktrees: [], activeWorktreePath: undefined, checkoutLabel: 'feature/current' })} />)
    })

    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Checkout: feature/current"]')
    expect(trigger?.textContent).toContain('feature/current')
    expect(trigger?.textContent).not.toBe('Workspace')
  })

  it('toggles the inspector panel from the last header control, aligned with the summary trigger', async () => {
    const onToggleInspector = vi.fn()
    await act(async () => {
      root.render(<ConversationHeader {...props({ inspectorOpen: true, onToggleInspector })} />)
    })

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Toggle inspector"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-pressed')).toBe('true')
    expect(trigger?.className).toContain('is-active')
    expect(trigger?.getBoundingClientRect().width).toBe(container.querySelector('.summary-anchor__trigger')?.getBoundingClientRect().width)

    await press(trigger!)
    expect(onToggleInspector).toHaveBeenCalledOnce()
  })

  it('shows the active branch and switches to another worktree', async () => {
    const onOpenWorktree = vi.fn()
    await act(async () => {
      root.render(<ConversationHeader {...props({ onOpenWorktree })} />)
    })

    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')
    expect(trigger).not.toBeNull()
    await press(trigger!)

    await press([...container.querySelectorAll('.summary-popover button')].find((button) => button.textContent?.includes('Worktrees'))!)
    const options = container.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="Worktrees"] [role="menuitemradio"]')
    expect(options).toHaveLength(2)
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    expect(options[1].textContent).toContain('feature/picker')
    expect(options[1].textContent).toContain('/repo-feature')

    await press(options[1])
    expect(onOpenWorktree).toHaveBeenCalledWith(worktrees[1])
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('creates a branch from the inline form and refreshes the switcher', async () => {
    const onCreateBranch = vi.fn().mockResolvedValue(undefined)
    const onBranches = vi.fn(async () => ['main', 'feature/new-picker'])
    await act(async () => {
      root.render(<ConversationHeader {...props({ onCreateBranch, onBranches })} />)
    })
    await press(container.querySelector<HTMLButtonElement>('[aria-label="Project menu"]')!)
    await press(container.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')!)

    const input = container.querySelector<HTMLInputElement>('[placeholder="New branch name"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'feature/new-picker')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = input.closest('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(onCreateBranch).toHaveBeenCalledWith('feature/new-picker')
    // The switcher list refreshes so the new branch shows up without reopening.
    expect(onBranches).toHaveBeenCalledTimes(2)
  })
})
