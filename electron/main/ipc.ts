import type { FeishuService } from './feishu/service'
import type { TaskService } from './tasks/service'
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, shell, type WebContents } from 'electron'
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel, type ApplicationMenuCommand, type ApplicationMenuName, type AppMeta, type HarnessId, type SessionChangeEvent, type ThemeMode } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import type { AgentBrowserService } from './browser/agent-service'
import type { CuaDriverService } from './cua-driver'
import type { GitService } from './git'
import type { ModelCatalogProvider } from './model-catalog'
import { createNodeOpenWithDependencies, createOpenWithService, isOpenWithTargetId } from './open-with'
import type { PetService } from './pets'
import type { PluginService } from './plugins'
import type { ProjectService } from './projects'
import type { AutomationService } from './schedules/service'
import type { SessionService } from './sessions'
import type { SettingsService } from './settings-schedules'
import type { TerminalService } from './terminal'
import type { UpdateService } from './updates'
import { requireExistingPath, requireRecord, requireString, requireWebUrl } from './validation'
import type { VoiceService } from './voice'
import type { HarnessRuntimeMap } from './harness-runtime'

interface Services {
  meta: AppMeta
  refreshHarnesses(): Promise<{ meta: AppMeta; settings: ReturnType<SettingsService['get']> }>
  popupApplicationMenu(sender: WebContents, menu: ApplicationMenuName, x: number, y: number): boolean
  /** Runs one bounded replica-menu command (edit roles, view actions) on the requesting WebContents. */
  applyMenuCommand(sender: WebContents, command: ApplicationMenuCommand): boolean
  /** Resolved renderer theme; on macOS it also drives inactive-window traffic-light visibility. */
  setTitleBarTheme(sender: WebContents, theme: Exclude<ThemeMode, 'system'>): boolean
  /** Sender-scoped replica title-bar window controls; each resolves its own BrowserWindow. */
  windowControls: {
    minimize(sender: WebContents): void
    toggleMaximize(sender: WebContents): void
    close(sender: WebContents): void
  }
  terminals: TerminalService
  git: GitService
  settings: SettingsService
  updates: UpdateService
  cuaDriver: CuaDriverService
  feishu: FeishuService
  tasks: TaskService
  schedules: AutomationService
  browser: AgentBrowserService
  voice: VoiceService
  pets: PetService
  /** Complete harness-scoped service registry; every harness is always present. */
  harnesses: HarnessRuntimeMap
  /** Applies the persisted interface scale to every live app renderer. */
  applyInterfaceZoom?(scale: number): void
}

/** Stored model-key → level map as the read-only map the catalog decorator consumes. */
function effortMap(effort: Record<string, AgentThinkingLevel>): ReadonlyMap<string, AgentThinkingLevel> {
  return new Map(Object.entries(effort))
}

function requireHarness(value: unknown): HarnessId {
  if (value === undefined) return 'omp'
  if (value === 'omp' || value === 'pi') return value
  throw new TypeError('Invalid harness')
}

function requireApplicationMenu(value: unknown): ApplicationMenuName {
  if (value === 'file' || value === 'edit' || value === 'view' || value === 'window' || value === 'help') return value
  throw new TypeError('Invalid application menu')
}

const MENU_COMMANDS: readonly ApplicationMenuCommand[] = [
  'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'toggleFullscreen',
]

function requireMenuCommand(value: unknown): ApplicationMenuCommand {
  if (typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value)) return value as ApplicationMenuCommand
  throw new TypeError('Invalid menu command')
}

function requireMenuCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000) throw new TypeError('Invalid menu coordinate')
  return Math.round(value)
}

function requireResolvedTheme(value: unknown): Exclude<ThemeMode, 'system'> {
  if (value === 'light' || value === 'dark') return value
  throw new TypeError('Invalid resolved theme')
}

type IpcEvent = IpcMainInvokeEvent | IpcMainEvent

export function isTrustedRendererUrl(url: string, expectedRendererUrl: string): boolean {
  try {
    const actual = new URL(url)
    const expected = new URL(expectedRendererUrl)
    // Fragments never cross the document/security boundary; allow in-document anchors only.
    actual.hash = ''
    expected.hash = ''
    return actual.href === expected.href
  } catch {
    return false
  }
}

export interface IpcRegistration {
  authorize(webContents: WebContents): void
  revoke(webContentsId: number): void
  dispose(): void
  /**
   * Resolves on the renderer bootstrap's first `app:get-meta` invoke, which
   * only reaches its handler once `verify` has admitted an authorized sender on
   * the trusted main frame. Nothing else observes it, so no verification work
   * is added to the shared invoke path.
   */
  whenRendererReady: Promise<void>
}

let activeIpcRegistration: IpcRegistration | null = null

export function registerIpc(services: Services, expectedRendererUrl: string): IpcRegistration {
  if (activeIpcRegistration) {
    console.warn('registerIpc called while a previous registration was still active; disposing the previous registration')
    activeIpcRegistration.dispose()
  }
  const authorized = new Map<number, WebContents>()
  const invokeChannels: string[] = []
  const eventChannels: string[] = []
  let closed = false
  let announceRendererReady: (() => void) | null = null
  const whenRendererReady = new Promise<void>((resolve) => {
    announceRendererReady = resolve
  })

  const verify = (event: IpcEvent): void => {
    const trustedFrame =
      event.senderFrame === event.sender.mainFrame && isTrustedRendererUrl(event.senderFrame.url, expectedRendererUrl) && isTrustedRendererUrl(event.sender.getURL(), expectedRendererUrl)
    if (closed || !authorized.has(event.sender.id) || event.sender.isDestroyed() || !trustedFrame) throw new Error('IPC sender is not authorized')
  }
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, ...args) => {
      verify(event)
      return listener(event, ...args)
    })
    invokeChannels.push(channel)
  }
  const on = (channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void => {
    const wrapped = (event: IpcMainEvent, ...args: unknown[]) => {
      try {
        verify(event)
        listener(event, ...args)
      } catch (error) {
        console.warn(`Rejected ${channel}:`, error instanceof Error ? error.message : error)
      }
    }
    // Symmetric with handle(): these are private fixed channels, so any prior listener is stale.
    ipcMain.removeAllListeners(channel)
    ipcMain.on(channel, wrapped)
    eventChannels.push(channel)
  }

  const harnesses = services.harnesses
  const projectsFor = (harness: HarnessId): ProjectService => harnesses[harness].projects
  const sessionsFor = (harness: HarnessId): SessionService => harnesses[harness].sessions
  const agentsFor = (harness: HarnessId): AgentRpcManager => harnesses[harness].agents
  const pluginsFor = (harness: HarnessId): PluginService => harnesses[harness].plugins
  // Runtime ids route by ownership; ids no manager owns fall through to the
  // OMP manager so requireRuntime keeps its exact not-found semantics.
  const agentsForRuntime = (runtimeId: unknown): AgentRpcManager => {
    if (typeof runtimeId === 'string') {
      for (const harness of ['omp', 'pi'] as const) {
        const manager = harnesses[harness].agents
        if (manager.has(runtimeId)) return manager
      }
    }
    return harnesses.omp.agents
  }
  /**
   * Routes a session file to the harness whose validated session root contains
   * it, using each service's own canonicalizing path authorization (never
   * substring checks). Main-registered live drafts can be read before disk persistence.
   * Paths outside both roots are rejected.
   */
  const sessionsForPath = async (filePath: unknown): Promise<{ harness: HarnessId; service: SessionService }> => {
    for (const harness of ['omp', 'pi'] as const) {
      if (harnesses[harness].sessions.hasPendingSession(filePath)) return { harness, service: harnesses[harness].sessions }
      try { await harnesses[harness].sessions.requireSessionPath(filePath) }
      catch { continue }
      return { harness, service: harnesses[harness].sessions }
    }
    throw new Error('Session path is not authorized')
  }

  handle('app:get-meta', () => {
    announceRendererReady?.()
    announceRendererReady = null
    return services.meta
  })
  handle('app:refresh-harnesses', () => services.refreshHarnesses())
  handle('app:popup-menu', (event, menu, x, y) => services.popupApplicationMenu(event.sender, requireApplicationMenu(menu), requireMenuCoordinate(x), requireMenuCoordinate(y)))
  handle('app:menu-command', (event, command) => services.applyMenuCommand(event.sender, requireMenuCommand(command)))
  handle('app:set-title-bar-theme', (event, theme) => services.setTitleBarTheme(event.sender, requireResolvedTheme(theme)))
  handle('app:minimize', (event) => {
    services.windowControls.minimize(event.sender)
  })
  handle('app:toggle-maximize', (event) => {
    services.windowControls.toggleMaximize(event.sender)
  })
  handle('app:close', (event) => {
    services.windowControls.close(event.sender)
  })
  handle('app:open-external', async (_event, url) => {
    try {
      await shell.openExternal(requireWebUrl(url, { mailto: true }), { activate: true })
      return true
    } catch (error) {
      console.warn('Rejected app:open-external:', error instanceof Error ? error.message : error)
      return false
    }
  })
  /** The read-only reveal grant: project folders, session files, and plugin paths across every harness. */
  const authorizeForReveal = async (requested: string): Promise<string | null> => {
    const authorizations: Array<() => Promise<string> | string> = [
      () => harnesses.omp.projects.authorizePath(requested),
      () => harnesses.omp.sessions.requireSessionPath(requested),
      () => harnesses.omp.plugins.authorizeReveal(requested),
      () => harnesses.pi.projects.authorizePath(requested),
      () => harnesses.pi.sessions.requireSessionPath(requested),
      () => harnesses.pi.plugins.authorizeReveal(requested),
    ]
    for (const authorize of authorizations) {
      try {
        return await authorize()
      } catch (error) {
        // A single domain not covering the path should not abort the chain;
        // the warning keeps unexpected rejections from disappearing silently.
        console.warn('Rejected app:reveal-path authorization candidate:', error instanceof Error ? error.message : error)
      }
    }
    return null
  }
  const openWith = createOpenWithService({
    ...createNodeOpenWithDependencies(),
    openFolder: (folder) => {
      void shell.openPath(folder)
    },
  })

  handle('app:reveal-path', async (_event, path) => {
    let requested: string
    try {
      requested = await requireExistingPath(path)
    } catch (error) {
      console.warn('Rejected app:reveal-path:', error instanceof Error ? error.message : error)
      return false
    }
    const authorized = await authorizeForReveal(requested)
    if (!authorized) {
      console.warn('Rejected app:reveal-path: no authorization domain covers the path')
      return false
    }
    try {
      shell.showItemInFolder(authorized)
      return true
    } catch (error) {
      console.warn('Rejected app:reveal-path:', error instanceof Error ? error.message : error)
      return false
    }
  })
  handle('app:open-with-targets', async (_event, path) => {
    try {
      const requested = await requireExistingPath(path)
      if (!(await authorizeForReveal(requested))) return []
      return await openWith.targets()
    } catch (error) {
      console.warn('Rejected app:open-with-targets:', error instanceof Error ? error.message : error)
      return []
    }
  })
  handle('app:open-with', async (_event, path, target) => {
    if (!isOpenWithTargetId(target)) {
      console.warn('Rejected app:open-with: unknown target')
      return false
    }
    try {
      const requested = await requireExistingPath(path)
      const authorized = await authorizeForReveal(requested)
      if (!authorized) return false
      await openWith.open(target, authorized)
      return true
    } catch (error) {
      console.warn('Rejected app:open-with:', error instanceof Error ? error.message : error)
      return false
    }
  })
  handle('updates:get-state', () => services.updates.getState())
  handle('updates:check', () => services.updates.check())
  handle('updates:download-and-install', () => services.updates.downloadAndInstall())

  handle('projects:list', (_event, harness) => projectsFor(requireHarness(harness)).list())
  handle('projects:list-files', (_event, root, harness) => projectsFor(requireHarness(harness)).listFiles(root))
  handle('projects:list-worktrees', (_event, cwd, harness) => projectsFor(requireHarness(harness)).listWorktrees(cwd))
  handle('projects:open-worktree', (_event, cwd, path, harness) => projectsFor(requireHarness(harness)).openWorktree(cwd, path))
  handle('projects:create-worktree', (_event, cwd, branch, harness) => projectsFor(requireHarness(harness)).createWorktree(cwd, branch))
  handle('projects:add', (_event, harness) => projectsFor(requireHarness(harness)).add())
  handle('projects:grant-inferred', (_event, path, harness) => projectsFor(requireHarness(harness)).grantInferred(path))
  handle('projects:remove', (_event, id, harness) => projectsFor(requireHarness(harness)).remove(id))
  handle('projects:set-hidden', (_event, id, hidden, harness) => projectsFor(requireHarness(harness)).setHidden(id, hidden))
  handle('projects:touch', (_event, id, harness) => projectsFor(requireHarness(harness)).touch(id))
  handle('projects:update-scripts', (_event, id, scripts, harness) => projectsFor(requireHarness(harness)).updateScripts(id, scripts))
  handle('projects:mark-setup-started', (_event, id, setup, harness) => projectsFor(requireHarness(harness)).markSetupStarted(id, setup))
  handle('projects:finish-setup', (_event, id, setup, exitCode, harness) => projectsFor(requireHarness(harness)).finishSetup(id, setup, exitCode))

  handle('sessions:list', (_event, projectPath, includeArchived, harness, force) => sessionsFor(requireHarness(harness)).list(projectPath, includeArchived, force))
  handle('sessions:read', async (_event, filePath) => (await sessionsForPath(filePath)).service.read(filePath))
  handle('sessions:rename', async (_event, filePath, title) => (await sessionsForPath(filePath)).service.rename(filePath, title))
  handle('sessions:archive', async (_event, filePath, archived) => {
    const routed = await sessionsForPath(filePath)
    const result = await routed.service.archive(filePath, archived)
    if (archived === true) {
      services.browser.closeForSession(filePath)
      await services.terminals.killForSession(filePath)
    }
    return result
  })

  handle('agent:start', (_event, rawOptions) => {
    const options = requireRecord(rawOptions, 'options')
    const harness = requireHarness(options.harness)
    // The manager start schema rejects unknown keys; the routing field must
    // not reach it.
    const { harness: _harness, ...startOptions } = options
    return agentsFor(harness).start(startOptions)
  })
  handle('agent:command', (_event, runtimeId, command) => agentsForRuntime(runtimeId).command(runtimeId, command))
  handle('agent:stop', (_event, runtimeId) => agentsForRuntime(runtimeId).stop(runtimeId))
  handle('agent:list', () => Object.values(harnesses).flatMap((runtime) => runtime.agents.list()))

  const ompProviderCatalog = (force = false) => {
    const settings = services.settings.get()
    return harnesses.omp.catalog.catalog(force, new Set(settings.ompDisabledProviders), new Set(settings.ompDisabledModels), effortMap(settings.modelEffort.omp))
  }
  const piProviderCatalog = (force = false) => {
    const settings = services.settings.get()
    return harnesses.pi.catalog.catalog(force, new Set(settings.piDisabledProviders), new Set(settings.piDisabledModels), effortMap(settings.modelEffort.pi))
  }
  const providerCatalogs: Record<HarnessId, (force?: boolean) => ReturnType<ModelCatalogProvider['catalog']>> = {
    omp: ompProviderCatalog,
    pi: piProviderCatalog,
  }
  /** Desktop-owned provider/model visibility settings keys per harness. */
  const disabledProvidersKeys = { omp: 'ompDisabledProviders', pi: 'piDisabledProviders' } as const
  const disabledModelsKeys = { omp: 'ompDisabledModels', pi: 'piDisabledModels' } as const
  handle('providers:catalog', (_event, force, harness) => providerCatalogs[requireHarness(harness)](force === true))
  handle('providers:set-enabled', async (_event, providerId, enabled, harness) => {
    const target = requireHarness(harness)
    const id = requireString(providerId, 'providerId', { min: 1, max: 128, trim: true })
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    const catalog = await providerCatalogs[target]()
    if (!catalog.providers.some((provider) => provider.id === id)) throw new Error('Provider was not found')
    const providerSettingsKey = disabledProvidersKeys[target]
    const modelSettingsKey = disabledModelsKeys[target]
    const settings = services.settings.get()
    const disabledProviders = new Set(settings[providerSettingsKey])
    const disabledModels = new Set(settings[modelSettingsKey])
    if (enabled) {
      disabledProviders.delete(id)
      for (const model of catalog.models) if (model.provider === id) disabledModels.delete(model.key)
    } else disabledProviders.add(id)
    await services.settings.update({
      [providerSettingsKey]: [...disabledProviders].sort(),
      [modelSettingsKey]: [...disabledModels].sort(),
    })
    return providerCatalogs[target]()
  })
  handle('providers:set-disabled', async (_event, providerIds, harness) => {
    const target = requireHarness(harness)
    if (!Array.isArray(providerIds) || providerIds.length > 256) throw new TypeError('providerIds must be a bounded array')
    const ids = [...new Set(providerIds.map((value, index) => requireString(value, `providerIds[${index}]`, { min: 1, max: 128, trim: true })))].sort()
    const catalog = await providerCatalogs[target]()
    const known = new Set(catalog.providers.map((provider) => provider.id))
    if (ids.some((id) => !known.has(id))) throw new Error('Provider was not found')
    const providerSettingsKey = disabledProvidersKeys[target]
    const modelSettingsKey = disabledModelsKeys[target]
    const disabledModels = ids.length ? services.settings.get()[modelSettingsKey] : []
    await services.settings.update({ [providerSettingsKey]: ids, [modelSettingsKey]: disabledModels })
    return providerCatalogs[target]()
  })
  handle('providers:set-model-enabled', async (_event, modelKey, enabled, harness) => {
    const target = requireHarness(harness)
    const key = requireString(modelKey, 'modelKey', { min: 3, max: 385, trim: true })
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    const catalog = await providerCatalogs[target]()
    const model = catalog.models.find((candidate) => candidate.key === key)
    if (!model) throw new Error('Model was not found')
    const provider = catalog.providers.find((candidate) => candidate.id === model.provider)
    if (!provider) throw new Error('Provider was not found')
    const providerSettingsKey = disabledProvidersKeys[target]
    const modelSettingsKey = disabledModelsKeys[target]
    const settings = services.settings.get()
    const disabledProviders = new Set(settings[providerSettingsKey])
    const disabledModels = new Set(settings[modelSettingsKey])
    const siblingKeys = catalog.models.filter((candidate) => candidate.provider === model.provider).map((candidate) => candidate.key)
    if (enabled) {
      if (!provider.enabled) {
        disabledProviders.delete(model.provider)
        for (const siblingKey of siblingKeys) if (siblingKey !== key) disabledModels.add(siblingKey)
      }
      disabledModels.delete(key)
    } else {
      disabledModels.add(key)
      if (!siblingKeys.some((siblingKey) => !disabledModels.has(siblingKey))) disabledProviders.add(model.provider)
    }
    await services.settings.update({
      [providerSettingsKey]: [...disabledProviders].sort(),
      [modelSettingsKey]: [...disabledModels].sort(),
    })
    return providerCatalogs[target]()
  })
  // A model's default reasoning effort is a Ptx preference, never a harness
  // credential: it only decides which level Ptx asks for when the model is
  // selected. An empty level clears the stored default.
  handle('providers:set-model-effort', async (_event, modelKey, level, harness) => {
    const target = requireHarness(harness)
    const key = requireString(modelKey, 'modelKey', { min: 3, max: 385, trim: true })
    if (level !== '' && (typeof level !== 'string' || !(AGENT_THINKING_LEVELS as readonly string[]).includes(level))) throw new TypeError('level must be a thinking level or an empty string')
    const catalog = await providerCatalogs[target]()
    const model = catalog.models.find((candidate) => candidate.key === key)
    if (!model) throw new Error('Model was not found')
    if (level && !model.availableThinkingLevels.includes(level as AgentThinkingLevel)) throw new Error(`${model.name} does not offer the ${level} reasoning level`)
    const current = { ...services.settings.get().modelEffort[target] }
    if (level) current[key] = level as AgentThinkingLevel
    else delete current[key]
    await services.settings.update({ modelEffort: { ...services.settings.get().modelEffort, [target]: current } })
    return providerCatalogs[target]()
  })
  handle('voice:credential-status', () => services.voice.credentialStatus())
  handle('voice:save-api-key', (_event, provider, apiKey) => services.voice.saveApiKey(provider, apiKey))
  handle('voice:delete-api-key', (_event, provider) => services.voice.deleteApiKey(provider))
  handle('voice:create-realtime-call', (_event, request) => services.voice.createRealtimeCall(request))
  handle('voice:transcribe', (_event, request) => services.voice.transcribe(request))
  handle('voice:test-self-hosted', (_event, request) => services.voice.testSelfHosted(request))
  handle('voice:execute-tool', (_event, request, harness) => services.voice.executeTool(request, requireHarness(harness)))

  handle('pets:list', () => services.pets.list())
  handle('pets:sprite', (_event, id) => services.pets.sprite(id))

  handle('terminal:create', (event, options) => services.terminals.create(event.sender, options))
  handle('terminal:bind-session', (event, terminalId, sessionPath) => services.terminals.bindSession(event.sender, terminalId, sessionPath))
  on('terminal:input', (event, terminalId, data) => services.terminals.input(event.sender, terminalId, data))
  on('terminal:resize', (event, terminalId, cols, rows) => services.terminals.resize(event.sender, terminalId, cols, rows))
  on('terminal:set-active-context', (event, terminalId, context) => services.terminals.setActiveContext(event.sender, terminalId, context))
  on('terminal:clear-active-context', (event, terminalId) => services.terminals.clearActiveContext(event.sender, terminalId))
  handle('terminal:kill', (event, terminalId) => services.terminals.kill(event.sender, terminalId))

  handle('git:status', (_event, cwd) => services.git.status(cwd))
  handle('git:diff', (_event, cwd, path, staged) => services.git.diff(cwd, path, staged))
  handle('git:stage', (_event, cwd, paths) => services.git.stage(cwd, paths))
  handle('git:unstage', (_event, cwd, paths) => services.git.unstage(cwd, paths))
  handle('git:restore', (_event, cwd, paths) => services.git.restore(cwd, paths))
  handle('git:commit', (_event, cwd, message) => services.git.commit(cwd, message))
  handle('git:push', (_event, cwd) => services.git.push(cwd))
  handle('git:pull', (_event, cwd) => services.git.pull(cwd))
  handle('git:ahead-commits', (_event, cwd) => services.git.aheadCommits(cwd))
  handle('git:undo-commit', (_event, cwd, hash) => services.git.undoCommit(cwd, hash))
  handle('git:branches', (_event, cwd) => services.git.branches(cwd))
  handle('git:switch-branch', (_event, cwd, branch) => services.git.switchBranch(cwd, branch))
  handle('git:create-branch', (_event, cwd, branch) => services.git.createBranch(cwd, branch))

  handle('plugins:list', (_event, projectPath, harness) => pluginsFor(requireHarness(harness)).list(projectPath))
  handle('plugins:install', (_event, source, harness) => pluginsFor(requireHarness(harness)).install(source))
  handle('plugins:install-extension', (_event, input, harness) => pluginsFor(requireHarness(harness)).installExtension(input))
  handle('plugins:set-mcp-support', (_event, enabled, harness) => pluginsFor(requireHarness(harness)).setMcpSupport(enabled))
  handle('plugins:connect-mcp', (_event, input, harness) => pluginsFor(requireHarness(harness)).connectMcp(input))
  handle('plugins:set-mcp-enabled', (_event, input, harness) => pluginsFor(requireHarness(harness)).setMcpEnabled(input))
  handle('plugins:probe-mcp', (_event, input, harness) => pluginsFor(requireHarness(harness)).probeMcp(input))
  handle('plugins:mutate-capability', (_event, input, harness) => pluginsFor(requireHarness(harness)).mutateCapability(input))
  handle('plugins:refresh', (_event, harness) => pluginsFor(requireHarness(harness)).refresh())

  handle('settings:get', () => services.settings.get())
  handle('settings:update', async (_event, patch) => {
    const previous = services.settings.get()
    const patchRecord = requireRecord(patch, 'settings patch')
    if (patchRecord.computerUseEnabled === true && !previous.computerUseEnabled) await services.cuaDriver.requireAvailable()
    const settings = await services.settings.update(patch)
    if (settings.interfaceFontScale !== previous.interfaceFontScale) services.applyInterfaceZoom?.(settings.interfaceFontScale)
    if (settings.askUserEnabled !== previous.askUserEnabled || settings.browserEnabled !== previous.browserEnabled || settings.computerUseEnabled !== previous.computerUseEnabled) {
      const managers = Object.values(harnesses).map((runtime) => runtime.agents)
      await Promise.all(managers.map((manager) => (
        manager && typeof manager.requestRuntimeEnvironmentRefresh === 'function'
          ? manager.requestRuntimeEnvironmentRefresh()
          : Promise.resolve()
      )))
    }
    return settings
  })
  handle('settings:reset-browser-data', () => services.settings.resetBrowserData())

  handle('browser:state', () => services.browser.state())
  handle('browser:attach-tab', (_event, tabId, webContentsId) => services.browser.attachTab(tabId, webContentsId))
  handle('browser:select-tab', (_event, tabId) => services.browser.selectTab(tabId))
  handle('browser:close-tab', (_event, tabId) => services.browser.closeTab(tabId))
  handle('browser:set-preview-context', (_event, webContentsId, sessionFile) => services.browser.setPreviewContext(webContentsId, sessionFile))
  handle('browser:navigate-tab', (_event, tabId, action, url) => services.browser.navigateTab(tabId, action, url))

  handle('feishu:binding-begin', () => services.feishu.binding.begin())
  handle('feishu:binding-status', () => services.feishu.binding.status())
  handle('feishu:binding-cancel', () => services.feishu.binding.cancel())
  handle('feishu:binding-finish', (_event, target) => services.feishu.finishBinding(target))
  handle('feishu:status', () => services.feishu.status())
  handle('feishu:save', (_event, config, secret) => services.feishu.save(config, secret))
  handle('feishu:connect', () => services.feishu.connect())
  handle('feishu:disconnect', () => services.feishu.disconnect())
  handle('feishu:forget', () => services.feishu.forget())
  handle('tasks:list', () => services.tasks.list())
  handle('tasks:create', (_event, input) => services.tasks.create(input))
  handle('tasks:start', (_event, id) => services.tasks.start(id))
  handle('tasks:stop', (_event, id) => services.tasks.stop(id))
  handle('tasks:accept', (_event, id) => services.tasks.accept(id))
  handle('tasks:revise', (_event, id, instructions) => services.tasks.revise(id, instructions))
  handle('tasks:evidence', (_event, id) => services.tasks.evidence(id))
  handle('tasks:templates', () => services.tasks.templates())
  handle('tasks:save-template', (_event, input) => services.tasks.saveTemplate(input))
  handle('tasks:delete-template', (_event, id) => services.tasks.deleteTemplate(id))
  handle('schedules:list', (_event, harness) => services.schedules.list(requireHarness(harness)))
  handle('schedules:get', (_event, id) => services.schedules.get(id))
  handle('schedules:preview', (_event, timing, count) => services.schedules.preview(timing, count))
  handle('schedules:create', (_event, input, harness) => services.schedules.create(input, 'user', requireHarness(harness)))
  handle('schedules:update', (_event, id, patch) => services.schedules.update(id, patch))
  handle('schedules:pause', (_event, id) => services.schedules.pause(id))
  handle('schedules:resume', (_event, id) => services.schedules.resume(id))
  handle('schedules:delete', (_event, id) => services.schedules.delete(id))
  handle('schedules:run-now', (_event, id) => services.schedules.runNow(id))

  const forwardSessionChange = (change: SessionChangeEvent): void => {
    for (const [id, contents] of authorized) {
      if (contents.isDestroyed()) {
        authorized.delete(id)
        continue
      }
      if (isTrustedRendererUrl(contents.getURL(), expectedRendererUrl) && isTrustedRendererUrl(contents.mainFrame.url, expectedRendererUrl)) contents.send('sessions:changed', change)
    }
  }
  const unsubscribeOmpSessionChanges = harnesses.omp.sessions.onDidChange(forwardSessionChange)
  const unsubscribePiSessionChanges = harnesses.pi.sessions.onDidChange(forwardSessionChange)
  const scheduleSubscription = services.schedules.onDidChange((change) => {
    for (const [id, contents] of authorized) {
      if (contents.isDestroyed()) {
        authorized.delete(id)
        continue
      }
      if (isTrustedRendererUrl(contents.getURL(), expectedRendererUrl) && isTrustedRendererUrl(contents.mainFrame.url, expectedRendererUrl)) contents.send('schedules:changed', change)
    }
  })
  const unsubscribeScheduleChanges = typeof scheduleSubscription === 'function' ? scheduleSubscription : () => undefined
  const browserSubscription = services.browser.onDidChange((state) => {
    for (const [id, contents] of authorized) {
      if (contents.isDestroyed()) {
        authorized.delete(id)
        continue
      }
      if (isTrustedRendererUrl(contents.getURL(), expectedRendererUrl) && isTrustedRendererUrl(contents.mainFrame.url, expectedRendererUrl)) contents.send('browser:changed', state)
    }
  })
  const unsubscribeBrowserChanges = typeof browserSubscription === 'function' ? browserSubscription : () => undefined
  const pointerSubscription = services.browser.onPointer((event) => {
    for (const [id, contents] of authorized) {
      if (contents.isDestroyed()) {
        authorized.delete(id)
        continue
      }
      if (isTrustedRendererUrl(contents.getURL(), expectedRendererUrl) && isTrustedRendererUrl(contents.mainFrame.url, expectedRendererUrl)) contents.send('browser:pointer', event)
    }
  })
  const unsubscribeBrowserPointer = typeof pointerSubscription === 'function' ? pointerSubscription : () => undefined
  const activitySubscription = services.browser.onActivity((event) => {
    for (const [id, contents] of authorized) {
      if (contents.isDestroyed()) {
        authorized.delete(id)
        continue
      }
      if (isTrustedRendererUrl(contents.getURL(), expectedRendererUrl) && isTrustedRendererUrl(contents.mainFrame.url, expectedRendererUrl)) contents.send('browser:activity', event)
    }
  })
  const unsubscribeBrowserActivity = typeof activitySubscription === 'function' ? activitySubscription : () => undefined

  const registration: IpcRegistration = {
    whenRendererReady,
    authorize(webContents) {
      if (!closed) authorized.set(webContents.id, webContents)
    },
    revoke(webContentsId) {
      authorized.delete(webContentsId)
      void services.terminals.killOwner(webContentsId)
    },
    dispose() {
      if (closed) return
      closed = true
      if (activeIpcRegistration === registration) activeIpcRegistration = null
      authorized.clear()
      unsubscribeOmpSessionChanges()
      unsubscribePiSessionChanges()
      if (typeof unsubscribeScheduleChanges === 'function') unsubscribeScheduleChanges()
      if (typeof unsubscribeBrowserChanges === 'function') unsubscribeBrowserChanges()
      if (typeof unsubscribeBrowserPointer === 'function') unsubscribeBrowserPointer()
      if (typeof unsubscribeBrowserActivity === 'function') unsubscribeBrowserActivity()
      for (const channel of invokeChannels) ipcMain.removeHandler(channel)
      // Event listeners are removed wholesale only for our private fixed channels.
      for (const channel of eventChannels) ipcMain.removeAllListeners(channel)
    },
  }
  activeIpcRegistration = registration
  return registration
}
