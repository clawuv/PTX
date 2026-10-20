import '../helpers/node-script-fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronMocks = vi.hoisted(() => ({
  app: {},
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

vi.mock('electron', () => electronMocks)

import { registerIpc, type IpcRegistration } from '../../electron/main/ipc'
import { OmpModelCatalogService, MAX_CATALOG_PROVIDERS } from '../../electron/main/providers-omp'

const EXPECTED_URL = 'prime-work://app/'
const PRIME_SESSION = '/home/user/.prime/agent/sessions/session.jsonl'
const OMP_SESSION = '/home/user/.omp/agent/sessions/bucket/session.jsonl'
const PI_SESSION = '/home/user/.pi/agent/sessions/--home-user-project--/session.jsonl'
const fixtureDirs: string[] = []

function fakeOverflowCatalog(): OmpModelCatalogService {
  const directory = mkdtempSync(join(tmpdir(), 'ptx-omp-ipc-catalog-'))
  fixtureDirs.push(directory)
  const executable = join(directory, 'omp.cjs')
  const models = Array.from({ length: MAX_CATALOG_PROVIDERS + 1 }, (_, index) => ({
    provider: `provider-${String(index).padStart(3, '0')}`,
    id: 'model',
    name: `Provider ${index} model`,
    reasoning: false,
    thinking: null,
    input: ['text'],
    contextWindow: 1,
    maxTokens: 1,
  }))
  writeFileSync(executable, `#!/usr/bin/env node
if (process.argv[2] === '--version') { process.stdout.write('omp/1.2.3\\n'); process.exit(0) }
if (process.argv[2] === 'models' && process.argv[3] === '--json') { process.stdout.write(${JSON.stringify(JSON.stringify({ models }))}); process.exit(0) }
process.exit(2)
`)
  chmodSync(executable, 0o755)
  return new OmpModelCatalogService(executable)
}

function serviceStub(): Record<string, unknown> {
  return new Proxy({}, { get: () => vi.fn(async () => undefined) })
}

interface Harness {
  invoke(channel: string, ...args: unknown[]): unknown
  services: ReturnType<typeof buildServices>
  registration: IpcRegistration
}

function buildServices() {
  const settingsState = { disabledProviders: ['blocked'], disabledModels: [], ompDisabledProviders: ['anthropic'], ompDisabledModels: [], piDisabledProviders: ['anthropic'], piDisabledModels: [], modelEffort: { omp: {} as Record<string, string>, pi: {} as Record<string, string> } }
  const catalog = (from: string, disabled: ReadonlySet<string> = new Set(), disabledModels: ReadonlySet<string> = new Set(), modelEffort: ReadonlyMap<string, string> = new Map()) => {
    const models = [
      { key: 'anthropic/claude', provider: 'anthropic', id: 'claude' },
      { key: 'openai/gpt', provider: 'openai', id: 'gpt' },
      { key: 'openai/gpt-mini', provider: 'openai', id: 'gpt-mini' },
    ]
    const providerEnabled = (id: string) => !disabled.has(id) && models.some((model) => model.provider === id && !disabledModels.has(model.key))
    return {
      from,
      models: models.map((model) => ({
        ...model,
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
        enabled: providerEnabled(model.provider) && !disabledModels.has(model.key),
        ...(modelEffort.get(model.key) ? { defaultThinkingLevel: modelEffort.get(model.key) } : {}),
      })),
      providers: ['anthropic', 'openai'].map((id) => ({ id, enabled: providerEnabled(id) })),
    }
  }
  const ompSessionGate = vi.fn(async (path: unknown) => {
    if (path === OMP_SESSION) return path
    throw new TypeError('Session path is outside the Prime session directory')
  })
  const piSessionGate = vi.fn(async (path: unknown) => {
    if (path === PI_SESSION) return path
    throw new TypeError('Session path is outside the Prime session directory')
  })
  return {
    meta: { version: '0.0.0-test' },
    refreshHarnesses: vi.fn(async () => ({ meta: { version: '0.0.0-refreshed' }, settings: settingsState })),
    terminals: { ...serviceStub(), killForSession: vi.fn(async () => undefined) },
    git: serviceStub(),
    settings: {
      ...serviceStub(),
      get: vi.fn(() => settingsState),
      update: vi.fn(async (patch: Partial<typeof settingsState>) => { Object.assign(settingsState, patch); return settingsState }),
    },
    schedules: { ...serviceStub(), onDidChange: vi.fn(() => () => undefined), list: vi.fn(() => 'scheduled'), create: vi.fn(async () => 'created') },
    browser: { ...serviceStub(), closeForSession: vi.fn(() => true), onDidChange: vi.fn(() => vi.fn()), onPointer: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn()) },
    omp: {
      plugins: { ...serviceStub(), list: vi.fn(async () => 'omp-plugins'), install: vi.fn(async () => undefined), installExtension: vi.fn(async () => undefined), setMcpSupport: vi.fn(async () => undefined), connectMcp: vi.fn(async () => undefined), setMcpEnabled: vi.fn(async () => undefined), refresh: vi.fn(async () => 'omp-plugins') },
      projects: { ...serviceStub(), list: vi.fn(async () => ['omp-projects']), listWorktrees: vi.fn(async () => ['omp-worktrees']), openWorktree: vi.fn(async () => 'omp-open'), createWorktree: vi.fn(async () => 'omp-create'), grantInferred: vi.fn(async () => 'omp-grant') },
      sessions: {
        ...serviceStub(),
        onDidChange: vi.fn(() => () => undefined),
        requireSessionPath: ompSessionGate,
        hasPendingSession: vi.fn(() => false),
        list: vi.fn(async () => ['omp-sessions']),
        read: vi.fn(async () => ['omp-transcript']),
        followUp: vi.fn(async () => true),
        rename: vi.fn(async () => false),
        archive: vi.fn(async () => true),
      },
      agents: {
        ...serviceStub(),
        has: vi.fn((id: string) => id === 'omp-runtime'),
        start: vi.fn(async (options: unknown) => ({ started: 'omp', options })),
        command: vi.fn(async () => ({ ok: 'omp' })),
        stop: vi.fn(async () => true),
        list: vi.fn(() => [{ runtimeId: 'omp-runtime', harness: 'omp' }]),
      },
      catalog: {
        catalog: vi.fn(async (_force, disabled, disabledModels, effort) => catalog('omp', disabled, disabledModels, effort)),
      },
    },
    pi: {
      plugins: { ...serviceStub(), list: vi.fn(async () => 'pi-plugins'), install: vi.fn(async () => undefined), installExtension: vi.fn(async () => undefined), setMcpSupport: vi.fn(async () => undefined), connectMcp: vi.fn(async () => undefined), setMcpEnabled: vi.fn(async () => undefined), refresh: vi.fn(async () => 'pi-plugins') },
      projects: { ...serviceStub(), list: vi.fn(async () => ['pi-projects']), listWorktrees: vi.fn(async () => ['pi-worktrees']), openWorktree: vi.fn(async () => 'pi-open'), createWorktree: vi.fn(async () => 'pi-create'), grantInferred: vi.fn(async () => 'pi-grant') },
      sessions: {
        ...serviceStub(),
        onDidChange: vi.fn(() => () => undefined),
        requireSessionPath: piSessionGate,
        hasPendingSession: vi.fn(() => false),
        list: vi.fn(async () => ['pi-sessions']),
        read: vi.fn(async () => ['pi-transcript']),
        followUp: vi.fn(async () => true),
        rename: vi.fn(async () => false),
        archive: vi.fn(async () => true),
      },
      agents: {
        ...serviceStub(),
        has: vi.fn((id: string) => id === 'pi-runtime'),
        start: vi.fn(async (options: unknown) => ({ started: 'pi', options })),
        command: vi.fn(async () => ({ ok: 'pi' })),
        stop: vi.fn(async () => true),
        list: vi.fn(() => [{ runtimeId: 'pi-runtime', harness: 'pi' }]),
      },
      catalog: {
        catalog: vi.fn(async (_force, disabled, disabledModels) => catalog('pi', disabled, disabledModels)),
      },
    },
  }
}

describe('harness-aware IPC routing', () => {
  let harness: Harness

  beforeEach(() => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    electronMocks.ipcMain.handle.mockReset()
    electronMocks.ipcMain.on.mockReset()
    electronMocks.ipcMain.handle.mockImplementation((channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    })
    const services = buildServices()
    const registration = registerIpc({ ...services, harnesses: { omp: { id: 'omp', ...services.omp }, pi: { id: 'pi', ...services.pi } } } as never, EXPECTED_URL)
    const mainFrame = { url: EXPECTED_URL }
    const sender = { id: 1, isDestroyed: () => false, getURL: () => EXPECTED_URL, mainFrame }
    registration.authorize(sender as never)
    const event = { sender, senderFrame: mainFrame }
    harness = {
      invoke: (channel, ...args) => handlers.get(channel)!(event, ...args),
      services,
      registration,
    }
  })

  afterEach(() => {
    harness.registration.dispose()
    for (const directory of fixtureDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('exposes harness refresh through the fixed authorized app channel', async () => {
    await expect(harness.invoke('app:refresh-harnesses')).resolves.toMatchObject({ meta: { version: '0.0.0-refreshed' } })
    expect(harness.services.refreshHarnesses).toHaveBeenCalledTimes(1)
  })

  it('rejects harness values outside the strict enum on every routed channel', async () => {
    for (const channel of ['projects:list', 'projects:add']) {
      await expect(async () => harness.invoke(channel, 'codex')).rejects.toThrow('Invalid harness')
    }
    await expect(async () => harness.invoke('sessions:list', undefined, false, 'OMP')).rejects.toThrow('Invalid harness')
    await expect(async () => harness.invoke('providers:catalog', false, { harness: 'omp' })).rejects.toThrow('Invalid harness')
    await expect(async () => harness.invoke('agent:start', { cwd: '/tmp', harness: 1 })).rejects.toThrow('Invalid harness')
    await expect(async () => harness.invoke('projects:list', 'Pi')).rejects.toThrow('Invalid harness')
    await expect(async () => harness.invoke('sessions:list', undefined, false, 'PI')).rejects.toThrow('Invalid harness')
    expect(harness.services.omp.agents.start).not.toHaveBeenCalled()
  })

  it('routes agent:start by harness and strips the routing field before the manager sees it', async () => {
    await expect(harness.invoke('agent:start', { cwd: '/work', harness: 'omp' })).resolves.toEqual({ started: 'omp', options: { cwd: '/work' } })
    expect(harness.services.omp.agents.start).toHaveBeenCalledWith({ cwd: '/work' })
    await expect(harness.invoke('agent:start', { cwd: '/work', harness: 'pi' })).resolves.toEqual({ started: 'pi', options: { cwd: '/work' } })
    expect(harness.services.pi.agents.start).toHaveBeenCalledWith({ cwd: '/work' })

    await expect(harness.invoke('agent:start', { cwd: '/work' })).resolves.toEqual({ started: 'omp', options: { cwd: '/work' } })
    expect(harness.services.omp.agents.start).toHaveBeenCalledWith({ cwd: '/work' })
  })

  it('routes agent:command and agent:stop by runtime ownership, defaulting unknown ids to OMP', async () => {
    await expect(harness.invoke('agent:command', 'omp-runtime', { type: 'abort' })).resolves.toEqual({ ok: 'omp' })
    expect(harness.services.omp.agents.command).toHaveBeenCalledWith('omp-runtime', { type: 'abort' })
    await expect(harness.invoke('agent:command', 'pi-runtime', { type: 'abort' })).resolves.toEqual({ ok: 'pi' })
    expect(harness.services.pi.agents.command).toHaveBeenCalledWith('pi-runtime', { type: 'abort' })

    await expect(harness.invoke('agent:command', 'prime-runtime', { type: 'abort' })).resolves.toEqual({ ok: 'omp' })
    expect(harness.services.omp.agents.command).toHaveBeenCalledWith('prime-runtime', { type: 'abort' })

    // An id neither manager owns lands on the Prime manager, preserving its
    // exact requireRuntime error semantics.
    await harness.invoke('agent:command', 'missing-runtime', { type: 'abort' })
    expect(harness.services.omp.agents.command).toHaveBeenCalledWith('missing-runtime', { type: 'abort' })

    await expect(harness.invoke('agent:stop', 'omp-runtime')).resolves.toBe(true)
    expect(harness.services.omp.agents.stop).toHaveBeenCalledWith('omp-runtime')
    await expect(harness.invoke('agent:stop', 'pi-runtime')).resolves.toBe(true)
    expect(harness.services.pi.agents.stop).toHaveBeenCalledWith('pi-runtime')
  })

  it('concatenates all managers for agent:list', () => {
    expect(harness.invoke('agent:list')).toEqual([
      { runtimeId: 'omp-runtime', harness: 'omp' },
      { runtimeId: 'pi-runtime', harness: 'pi' },
    ])
  })

  it('routes sessions:list and projects channels by the harness argument, defaulting to OMP', async () => {
    await expect(harness.invoke('sessions:list', undefined, false)).resolves.toEqual(['omp-sessions'])
    await expect(harness.invoke('sessions:list', undefined, false, 'omp')).resolves.toEqual(['omp-sessions'])
    await expect(harness.invoke('sessions:list', '/repo', true, 'omp', true)).resolves.toEqual(['omp-sessions'])
    expect(harness.services.omp.sessions.list).toHaveBeenLastCalledWith('/repo', true, true)
    await expect(harness.invoke('sessions:list', undefined, false, 'pi')).resolves.toEqual(['pi-sessions'])
    await expect(harness.invoke('projects:list')).resolves.toEqual(['omp-projects'])
    await expect(harness.invoke('projects:list', 'omp')).resolves.toEqual(['omp-projects'])
    await expect(harness.invoke('projects:grant-inferred', '/somewhere', 'omp')).resolves.toBe('omp-grant')
    expect(harness.services.omp.projects.grantInferred).toHaveBeenCalledWith('/somewhere')
    await expect(harness.invoke('projects:grant-inferred', '/somewhere', 'pi')).resolves.toBe('pi-grant')
    expect(harness.services.pi.projects.grantInferred).toHaveBeenCalledWith('/somewhere')
    await expect(harness.invoke('projects:list-worktrees', '/repo', 'omp')).resolves.toEqual(['omp-worktrees'])
    await expect(harness.invoke('projects:open-worktree', '/repo', '/linked', 'omp')).resolves.toBe('omp-open')
    await expect(harness.invoke('projects:create-worktree', '/repo', 'feature', 'omp')).resolves.toBe('omp-create')
    expect(harness.services.omp.projects.listWorktrees).toHaveBeenCalledWith('/repo')
    expect(harness.services.omp.projects.openWorktree).toHaveBeenCalledWith('/repo', '/linked')
    expect(harness.services.omp.projects.createWorktree).toHaveBeenCalledWith('/repo', 'feature')
  })

  it('routes plugin catalog, installation, and MCP configuration by harness', async () => {
    await harness.invoke('plugins:list', '/repo', 'omp')
    expect(harness.services.omp.plugins.list).toHaveBeenCalledWith('/repo')

    await harness.invoke('plugins:install', 'npm:example', 'omp')
    expect(harness.services.omp.plugins.install).toHaveBeenCalledWith('npm:example')
    await harness.invoke('plugins:install-extension', { source: '/tmp/example.ts', scope: 'user' }, 'omp')
    expect(harness.services.omp.plugins.installExtension).toHaveBeenCalledWith({ source: '/tmp/example.ts', scope: 'user' })
    await harness.invoke('plugins:set-mcp-support', true, 'pi')
    expect(harness.services.pi.plugins.setMcpSupport).toHaveBeenCalledWith(true)
    await harness.invoke('plugins:connect-mcp', { name: 'docs' }, 'omp')
    expect(harness.services.omp.plugins.connectMcp).toHaveBeenCalledWith({ name: 'docs' })
    await harness.invoke('plugins:set-mcp-enabled', { name: 'docs', scope: 'user', enabled: false }, 'omp')
    expect(harness.services.omp.plugins.setMcpEnabled).toHaveBeenCalledWith({ name: 'docs', scope: 'user', enabled: false })
    await harness.invoke('plugins:refresh', 'omp')
    expect(harness.services.omp.plugins.refresh).toHaveBeenCalledOnce()
    await harness.invoke('plugins:list', '/repo', 'pi')
    expect(harness.services.pi.plugins.list).toHaveBeenCalledWith('/repo')
    await harness.invoke('plugins:install', 'npm:example', 'pi')
    expect(harness.services.pi.plugins.install).toHaveBeenCalledWith('npm:example')
    await harness.invoke('plugins:connect-mcp', { name: 'docs' }, 'pi')
    expect(harness.services.pi.plugins.connectMcp).toHaveBeenCalledWith({ name: 'docs' })
    await harness.invoke('plugins:refresh', 'pi')
    expect(harness.services.pi.plugins.refresh).toHaveBeenCalledOnce()

    await expect(async () => harness.invoke('plugins:list', undefined, 'OMP')).rejects.toThrow('Invalid harness')
  })

  it('routes session file operations by which harness root authorizes the path', async () => {
    await expect(harness.invoke('sessions:read', OMP_SESSION)).resolves.toEqual(['omp-transcript'])
    expect(harness.services.omp.sessions.read).toHaveBeenCalledWith(OMP_SESSION)

    await expect(harness.invoke('sessions:read', PRIME_SESSION)).rejects.toThrow('Session path is not authorized')
    await expect(harness.invoke('sessions:read', PI_SESSION)).resolves.toEqual(['pi-transcript'])
    expect(harness.services.pi.sessions.read).toHaveBeenCalledWith(PI_SESSION)

    // A path neither root contains fails with the Prime service's own error.
    await expect(async () => harness.invoke('sessions:read', '/etc/passwd')).rejects.toThrow('Session path is not authorized')

    await expect(harness.invoke('sessions:rename', OMP_SESSION, 'Title')).resolves.toBe(false)
    expect(harness.services.omp.sessions.rename).toHaveBeenCalledWith(OMP_SESSION, 'Title')
    await expect(harness.invoke('sessions:archive', OMP_SESSION, true)).resolves.toBe(true)
    expect(harness.services.omp.sessions.archive).toHaveBeenCalledWith(OMP_SESSION, true)
    expect(harness.services.browser.closeForSession).toHaveBeenCalledWith(OMP_SESSION)
    expect(harness.services.terminals.killForSession).toHaveBeenCalledWith(OMP_SESSION)
    await expect(harness.invoke('sessions:rename', PI_SESSION, 'Title')).resolves.toBe(false)
    expect(harness.services.pi.sessions.rename).toHaveBeenCalledWith(PI_SESSION, 'Title')
    await expect(harness.invoke('sessions:archive', PI_SESSION, true)).resolves.toBe(true)
    expect(harness.services.pi.sessions.archive).toHaveBeenCalledWith(PI_SESSION, true)
    expect(harness.services.browser.closeForSession).toHaveBeenCalledWith(PI_SESSION)
    expect(harness.services.terminals.killForSession).toHaveBeenCalledWith(PI_SESSION)

    harness.services.browser.closeForSession.mockClear()
    harness.services.terminals.killForSession.mockClear()
    await expect(harness.invoke('sessions:archive', OMP_SESSION, false)).resolves.toBe(true)
    expect(harness.services.browser.closeForSession).not.toHaveBeenCalled()
    expect(harness.services.terminals.killForSession).not.toHaveBeenCalled()
  })

  it('routes providers:catalog with independent desktop visibility per harness', async () => {
    await expect(harness.invoke('providers:catalog', true)).resolves.toMatchObject({ from: 'omp' })
    expect(harness.services.omp.catalog.catalog).toHaveBeenCalledWith(true, new Set(['anthropic']), new Set(), new Map())

    await expect(harness.invoke('providers:catalog', true, 'omp')).resolves.toMatchObject({ from: 'omp' })
    expect(harness.services.omp.catalog.catalog).toHaveBeenCalledWith(true, new Set(['anthropic']), new Set(), new Map())
    await expect(harness.invoke('providers:catalog', true, 'pi')).resolves.toMatchObject({ from: 'pi' })
    expect(harness.services.pi.catalog.catalog).toHaveBeenCalledWith(true, new Set(['anthropic']), new Set(), new Map())
  })

  it('does not register MCP-specific authentication or credential cleanup channels', () => {
    expect(electronMocks.ipcMain.handle).not.toHaveBeenCalledWith('providers:start-mcp-oauth', expect.any(Function))
    expect(electronMocks.ipcMain.handle).not.toHaveBeenCalledWith('providers:logout-mcp', expect.any(Function))
  })

  it('stores OMP provider visibility in desktop settings without mutating OMP', async () => {
    await expect(harness.invoke('providers:set-enabled', 'openai', false, 'omp')).resolves.toMatchObject({
      from: 'omp',
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: false }],
    })
    expect(harness.services.settings.update).toHaveBeenCalledWith({ ompDisabledProviders: ['anthropic', 'openai'], ompDisabledModels: [] })

    await expect(harness.invoke('providers:set-disabled', ['openai'], 'omp')).resolves.toMatchObject({
      from: 'omp',
      providers: [{ id: 'anthropic', enabled: true }, { id: 'openai', enabled: false }],
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ ompDisabledProviders: ['openai'], ompDisabledModels: [] })
  })

  it('stores Pi provider visibility in Pi-specific desktop settings', async () => {
    await expect(harness.invoke('providers:set-enabled', 'openai', false, 'pi')).resolves.toMatchObject({
      from: 'pi',
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: false }],
    })
    expect(harness.services.settings.update).toHaveBeenCalledWith({ piDisabledProviders: ['anthropic', 'openai'], piDisabledModels: [] })

    await expect(harness.invoke('providers:set-disabled', ['openai'], 'pi')).resolves.toMatchObject({
      from: 'pi',
      providers: [{ id: 'anthropic', enabled: true }, { id: 'openai', enabled: false }],
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ piDisabledProviders: ['openai'], piDisabledModels: [] })
  })

  it('stores a per-model default reasoning effort and rejects unknown models or levels', async () => {
    await expect(harness.invoke('providers:set-model-effort', 'openai/gpt', 'high', 'omp')).resolves.toMatchObject({
      from: 'omp',
      models: expect.arrayContaining([expect.objectContaining({ key: 'openai/gpt', defaultThinkingLevel: 'high' })]),
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ modelEffort: { omp: { 'openai/gpt': 'high' }, pi: {} } })

    // An empty level clears the stored default instead of persisting a no-op.
    await expect(harness.invoke('providers:set-model-effort', 'openai/gpt', '', 'omp')).resolves.toMatchObject({
      models: expect.arrayContaining([expect.objectContaining({ key: 'openai/gpt' })]),
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ modelEffort: { omp: {}, pi: {} } })

    await expect(async () => harness.invoke('providers:set-model-effort', 'openai/gpt', 'turbo', 'omp')).rejects.toThrow('level must be a thinking level or an empty string')
    await expect(async () => harness.invoke('providers:set-model-effort', 'openai/missing', 'high', 'omp')).rejects.toThrow('Model was not found')
  })

  it('scopes the stored reasoning default to the requesting harness', async () => {
    await expect(harness.invoke('providers:set-model-effort', 'openai/gpt', 'low', 'pi')).resolves.toBeTruthy()
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ modelEffort: { omp: {}, pi: { 'openai/gpt': 'low' } } })
  })

  it('keeps OMP provider and model visibility synchronized in both directions', async () => {
    await expect(harness.invoke('providers:set-enabled', 'openai', false, 'omp')).resolves.toMatchObject({
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: false }],
      models: [
        { key: 'anthropic/claude', enabled: false },
        { key: 'openai/gpt', enabled: false },
        { key: 'openai/gpt-mini', enabled: false },
      ],
    })

    await expect(harness.invoke('providers:set-model-enabled', 'openai/gpt', true, 'omp')).resolves.toMatchObject({
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: true }],
      models: [
        { key: 'anthropic/claude', enabled: false },
        { key: 'openai/gpt', enabled: true },
        { key: 'openai/gpt-mini', enabled: false },
      ],
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ ompDisabledProviders: ['anthropic'], ompDisabledModels: ['openai/gpt-mini'] })

    await expect(harness.invoke('providers:set-model-enabled', 'openai/gpt', false, 'omp')).resolves.toMatchObject({
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: false }],
      models: [
        { key: 'anthropic/claude', enabled: false },
        { key: 'openai/gpt', enabled: false },
        { key: 'openai/gpt-mini', enabled: false },
      ],
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ ompDisabledProviders: ['anthropic', 'openai'], ompDisabledModels: ['openai/gpt', 'openai/gpt-mini'] })

    await expect(harness.invoke('providers:set-enabled', 'openai', true, 'omp')).resolves.toMatchObject({
      providers: [{ id: 'anthropic', enabled: false }, { id: 'openai', enabled: true }],
      models: [
        { key: 'anthropic/claude', enabled: false },
        { key: 'openai/gpt', enabled: true },
        { key: 'openai/gpt-mini', enabled: true },
      ],
    })
    expect(harness.services.settings.update).toHaveBeenLastCalledWith({ ompDisabledProviders: ['anthropic'], ompDisabledModels: [] })
  })

  it('applies provider and model toggles only to models retained by a real overflow catalog', async () => {
    const overflowCatalog = fakeOverflowCatalog()
    const catalogService = harness.services.omp.catalog as unknown as { catalog: OmpModelCatalogService['catalog'] }
    catalogService.catalog = overflowCatalog.catalog.bind(overflowCatalog)

    const initial = await harness.invoke('providers:catalog', true, 'omp') as Awaited<ReturnType<OmpModelCatalogService['catalog']>>
    expect(initial.providers).toHaveLength(MAX_CATALOG_PROVIDERS)
    expect(initial.models).toHaveLength(MAX_CATALOG_PROVIDERS)
    expect(initial.models.some((model) => model.key === 'provider-256/model')).toBe(false)

    const disabled = await harness.invoke('providers:set-enabled', 'provider-000', false, 'omp') as Awaited<ReturnType<OmpModelCatalogService['catalog']>>
    expect(disabled.providers.find((provider) => provider.id === 'provider-000')?.enabled).toBe(false)
    expect(disabled.models.find((model) => model.key === 'provider-000/model')?.enabled).toBe(false)

    const reenabled = await harness.invoke('providers:set-model-enabled', 'provider-000/model', true, 'omp') as Awaited<ReturnType<OmpModelCatalogService['catalog']>>
    expect(reenabled.providers.find((provider) => provider.id === 'provider-000')?.enabled).toBe(true)
    expect(reenabled.models.find((model) => model.key === 'provider-000/model')?.enabled).toBe(true)
    await expect(async () => harness.invoke('providers:set-enabled', 'provider-256', false, 'omp')).rejects.toThrow('Provider was not found')
    await expect(async () => harness.invoke('providers:set-model-enabled', 'provider-256/model', false, 'omp')).rejects.toThrow('Model was not found')
  })

  it('does not register retired daemon, credential, or heartbeat channels', () => {
    for (const channel of ['sessions:follow-up', 'providers:save-api-key', 'providers:logout', 'providers:start-oauth', 'providers:respond-oauth', 'providers:cancel-oauth', 'heartbeats:list', 'heartbeats:manage']) {
      expect(electronMocks.ipcMain.handle).not.toHaveBeenCalledWith(channel, expect.any(Function))
    }
    expect(() => harness.invoke('projects:list', 'prime')).toThrow('Invalid harness')
  })

  it.each(['omp', 'pi'] as const)('routes schedules channels with the %s harness argument', async (harnessId) => {
    expect(harness.invoke('schedules:list', harnessId)).toBe('scheduled')
    expect(harness.services.schedules.list).toHaveBeenCalledWith(harnessId)
    await expect(harness.invoke('schedules:create', { prompt: 'p' }, harnessId)).resolves.toBe('created')
    expect(harness.services.schedules.create).toHaveBeenCalledWith({ prompt: 'p' }, 'user', harnessId)
  })
})
