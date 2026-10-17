// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TasksPage } from '../../src/pages/TasksPage'
import type { ProjectRecord, PtxApi } from '../../src/types/api'
import type { DevelopmentTask } from '../../src/types/tasks'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const at = '2026-10-17T00:00:00.000Z'
const project: ProjectRecord = { id: 'project', harness: 'pi', name: 'Example', path: '/example', primaryFolder: '/example', folders: ['/example'], pinned: false, createdAt: at, lastOpenedAt: at, sessionCount: 1 }
const task: DevelopmentTask = { id: 'task', projectId: 'project', projectName: 'Example', harness: 'pi', cwd: '/example', model: 'provider/model', title: 'Improve export', goal: 'Add CSV export', acceptance: 'Export contains all rows', status: 'review', sessionFile: '/session.jsonl', createdAt: at, updatedAt: at, history: [{ status: 'review', at }] }
function bridgeFixture(records: DevelopmentTask[] = [task]) {
  return {
    tasks: {
      list: vi.fn(async () => records), templates: vi.fn(async () => [{ id: 'template', name: 'Repair bug', goal: 'Fix the reproduction', acceptance: 'Run regression checks' }]),
      evidence: vi.fn(async () => ({ capturedAt: at, git: { isRepo: true, files: [] }, messages: [{ id: 'tool', role: 'tool', parts: [{ type: 'toolResult', name: 'bash', text: '1 test failed', isError: true }] }] })),
      accept: vi.fn(async () => ({ ...task, status: 'accepted' })),
      saveTemplate: vi.fn(async () => ({ id: 'template' })), create: vi.fn(async () => ({ ...task, status: 'draft' })),
    },
    projects: { list: vi.fn(async (harness: string) => harness === 'pi' ? [project] : []) },
    providers: { catalog: vi.fn(async () => ({ models: [{ key: 'provider/model', provider: 'provider', id: 'model', name: 'Full model name', available: true, enabled: true, availableThinkingLevels: ['high'] }] })) },
  }
}
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!
async function click(text: string) { await act(async () => { button(text).click() }) }
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('task workflow UI', () => {
  it('shows actual error evidence and requires a manual acceptance action', async () => {
    const bridge = bridgeFixture()
    await act(async () => { root.render(<TasksPage bridge={bridge as unknown as PtxApi} harness="pi" onOpenSession={vi.fn()} />) })
    expect(bridge.tasks.accept).not.toHaveBeenCalled()
    await click('Improve export')
    expect(container.textContent).toContain('Tool reported an error')
    expect(container.textContent).toContain('1 test failed')
    expect(container.textContent).toContain('Export contains all rows')
    expect(bridge.tasks.accept).not.toHaveBeenCalled()
    await click('Mark accepted')
    expect(bridge.tasks.accept).toHaveBeenCalledWith('task')
  })
  it('opens the bound session using its own harness', async () => {
    const bridge = bridgeFixture()
    const open = vi.fn()
    await act(async () => root.render(<TasksPage bridge={bridge as unknown as PtxApi} harness="omp" onOpenSession={open} />))
    await click('Improve export'); await click('Open session')
    expect(open).toHaveBeenCalledWith('/session.jsonl', 'pi')
  })
  it('filters tasks without changing their underlying records', async () => {
    const bridge = bridgeFixture()
    await act(async () => root.render(<TasksPage bridge={bridge as unknown as PtxApi} harness="pi" onOpenSession={vi.fn()} />))
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="All statuses"]')!
    await act(async () => { select.value = 'failed'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('No matching tasks')
    await act(async () => { select.value = 'review'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('Improve export')
  })
  it('applies goal and acceptance from a reusable template and keeps model and harness explicit', async () => {
    const bridge = bridgeFixture([])
    await act(async () => root.render(<TasksPage bridge={bridge as unknown as PtxApi} harness="pi" onOpenSession={vi.fn()} />))
    await click('New task')
    const template = [...container.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Task template'))!.querySelector('select')!
    await act(async () => { template.value = 'template'; template.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector('input[maxlength="160"]')?.getAttribute('value')).toBe('Repair bug')
    expect([...container.querySelectorAll('textarea')].map((input) => input.value)).toEqual(['Fix the reproduction', 'Run regression checks'])
    expect(container.textContent).toContain('Full model name')
    const form = container.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(bridge.tasks.create).toHaveBeenCalledWith(expect.objectContaining({ harness: 'pi', model: 'provider/model', cwd: '/example', acceptance: 'Run regression checks' }))
  })
  it('preserves the task and prevents acceptance when evidence cannot be loaded', async () => {
    const bridge = bridgeFixture()
    bridge.tasks.evidence.mockRejectedValue(new Error('Grant revoked'))
    await act(async () => root.render(<TasksPage bridge={bridge as unknown as PtxApi} harness="pi" onOpenSession={vi.fn()} />))
    await click('Improve export')
    expect(container.textContent).toContain('Grant revoked')
    expect(button('Mark accepted').disabled).toBe(true)
    expect(bridge.tasks.accept).not.toHaveBeenCalled()
  })
})
