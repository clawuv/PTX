// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSettings } from '../../src/pages/settings/McpSettings'
import type { SkillRecord } from '../../src/types/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mcpSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: 'mcp-demo',
  name: 'demo-server',
  description: '',
  kind: 'mcp',
  location: 'user',
  enabled: true,
  source: 'demo',
  ...overrides,
})


describe('McpSettings connection status', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (window as { ptx?: unknown }).ptx
    vi.restoreAllMocks()
  })

  it('shows a per-server status and refreshes on demand', async () => {
    const probeMcp = vi.fn().mockResolvedValue({ ok: true, latencyMs: 42, serverName: 'demo', serverVersion: '1.0.0' })
    const list = vi.fn().mockResolvedValue({ skills: [mcpSkill()], warnings: [] })
    Object.defineProperty(window, 'ptx', { configurable: true, value: { plugins: { list, probeMcp } } })
    act(() => root.render(<McpSettings initialHarness="omp" projects={[]} />))
    // The automatic sweep probes each server once the catalog arrives.
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Connected')
      expect(container.textContent).toContain('42 ms')
    })
    expect(probeMcp).toHaveBeenCalledWith({ name: 'demo-server', scope: 'user' }, 'omp')

    // The row refresh button re-probes that single server.
    probeMcp.mockResolvedValueOnce({ ok: false, detail: 'command was not found' })
    const rowRefresh = container.querySelector<HTMLButtonElement>('.mcp-row__refresh')
    expect(rowRefresh).not.toBeNull()
    await act(async () => { rowRefresh!.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => expect(container.textContent).toContain('Failed'))
  })

  it('reports a failure detail when the probe rejects', async () => {
    const probeMcp = vi.fn().mockRejectedValue(new TypeError('probe channel failed'))
    const list = vi.fn().mockResolvedValue({ skills: [mcpSkill()], warnings: [] })
    Object.defineProperty(window, 'ptx', { configurable: true, value: { plugins: { list, probeMcp } } })
    act(() => root.render(<McpSettings initialHarness="omp" projects={[]} />))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Failed')
      const status = container.querySelector('.mcp-row__status--fail')
      expect(status?.getAttribute('title')).toContain('probe channel failed')
    })
  })

  it('offers the global status refresh for every server row', async () => {
    const probeMcp = vi.fn().mockResolvedValue({ ok: false, detail: 'offline' })
    const list = vi.fn().mockResolvedValue({ skills: [mcpSkill(), mcpSkill({ id: 'mcp-second', name: 'second-server' })], warnings: [] })
    Object.defineProperty(window, 'ptx', { configurable: true, value: { plugins: { list, probeMcp } } })
    act(() => root.render(<McpSettings initialHarness="omp" projects={[]} />))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => expect(probeMcp).toHaveBeenCalledTimes(2))

    const refreshAll = [...container.querySelectorAll<HTMLButtonElement>('.mcp-settings > header button')]
      .find((button) => button.textContent?.includes('Refresh status'))
    expect(refreshAll).toBeTruthy()
    const calls = probeMcp.mock.calls.length
    await act(async () => { refreshAll!.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => expect(probeMcp.mock.calls.length).toBeGreaterThan(calls))
  })
})

