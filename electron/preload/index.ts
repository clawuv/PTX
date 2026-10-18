import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentBrowserActivityEvent,
  AgentBrowserPointerEvent,
  AgentBrowserState,
  AppUpdateState,
  AgentEventEnvelope,
  PtxApi,
  ScheduleChangeEvent,
  SessionChangeEvent,
  TerminalDataEvent,
  TerminalExitEvent,
} from '../../src/types/api'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  if (typeof callback !== 'function') throw new TypeError('callback must be a function')
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    if (typeof payload === 'object' && payload !== null) callback(payload as T)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

function subscribeSignal(channel: string, callback: () => void): () => void {
  if (typeof callback !== 'function') throw new TypeError('callback must be a function')
  const listener = (): void => callback()
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    if (!(error instanceof Error)) throw error
    const match = /^Error invoking remote method '[^']+': ([A-Za-z_$][\w$]*): ([\s\S]*)$/.exec(error.message)
    if (!match) throw error
    console.error('Electron IPC invocation failed:', error)
    const unwrapped = new Error(match[2])
    Object.setPrototypeOf(unwrapped, Object.getPrototypeOf(error))
    unwrapped.name = error.name
    Object.defineProperty(unwrapped, 'cause', { value: error, configurable: true })
    throw unwrapped
  })
}

const api: PtxApi = {
  feishu: {
    beginBinding: () => invoke('feishu:binding-begin'),
    bindingStatus: () => invoke('feishu:binding-status'),
    cancelBinding: () => invoke('feishu:binding-cancel'),
    finishBinding: (target) => invoke('feishu:binding-finish', target),
    status: () => invoke('feishu:status'),
    save: (config, secret) => invoke('feishu:save', config, secret),
    connect: () => invoke('feishu:connect'),
    disconnect: () => invoke('feishu:disconnect'),
    forget: () => invoke('feishu:forget'),
  },
  tasks: {
    list: () => invoke('tasks:list'),
    create: (input) => invoke('tasks:create', input),
    start: (id) => invoke('tasks:start', id),
    stop: (id) => invoke('tasks:stop', id),
    accept: (id) => invoke('tasks:accept', id),
    revise: (id, instructions) => invoke('tasks:revise', id, instructions),
    evidence: (id) => invoke('tasks:evidence', id),
    templates: () => invoke('tasks:templates'),
    saveTemplate: (input) => invoke('tasks:save-template', input),
    deleteTemplate: (id) => invoke('tasks:delete-template', id),
  },
  app: {
    getMeta: () => invoke('app:get-meta'),
    refreshHarnesses: () => invoke('app:refresh-harnesses'),
    openExternal: (url) => invoke('app:open-external', url),
    revealPath: (path) => invoke('app:reveal-path', path),
    openWithTargets: (path) => invoke('app:open-with-targets', path),
    openWith: (path, target) => invoke('app:open-with', path, target),
    popupMenu: (menu, x, y) => invoke('app:popup-menu', menu, x, y),
    menuCommand: (command) => invoke('app:menu-command', command),
    setTitleBarTheme: (theme) => invoke('app:set-title-bar-theme', theme),
    minimize: () => invoke('app:minimize'),
    toggleMaximize: () => invoke('app:toggle-maximize'),
    close: () => invoke('app:close'),
    onOpenSettings: (callback) => subscribeSignal('app:open-settings', callback),
  },
  updates: {
    getState: () => invoke('updates:get-state'),
    check: () => invoke('updates:check'),
    downloadAndInstall: () => invoke('updates:download-and-install'),
    onChanged: (callback) => subscribe<AppUpdateState>('updates:changed', callback),
  },
  projects: {
    list: (harness) => invoke('projects:list', harness),
    listFiles: (root, harness) => invoke('projects:list-files', root, harness),
    listWorktrees: (cwd, harness) => invoke('projects:list-worktrees', cwd, harness),
    openWorktree: (cwd, path, harness) => invoke('projects:open-worktree', cwd, path, harness),
    createWorktree: (cwd, branch, harness) => invoke('projects:create-worktree', cwd, branch, harness),
    add: (harness) => invoke('projects:add', harness),
    grantInferred: (path, harness) => invoke('projects:grant-inferred', path, harness),
    remove: (id, harness) => invoke('projects:remove', id, harness),
    touch: (id, harness) => invoke('projects:touch', id, harness),
    updateScripts: (id, scripts, harness) => invoke('projects:update-scripts', id, scripts, harness),
    markSetupStarted: (id, setup, harness) => invoke('projects:mark-setup-started', id, setup, harness),
    finishSetup: (id, setup, exitCode, harness) => invoke('projects:finish-setup', id, setup, exitCode, harness),
  },
  sessions: {
    list: (projectPath, includeArchived, harness, force) => invoke('sessions:list', projectPath, includeArchived, harness, force),
    read: (filePath) => invoke('sessions:read', filePath),
    rename: (filePath, title) => invoke('sessions:rename', filePath, title),
    archive: (filePath, archived) => invoke('sessions:archive', filePath, archived),
    onChanged: (callback) => subscribe<SessionChangeEvent>('sessions:changed', callback),
  },
  agent: {
    start: (options) => invoke('agent:start', options),
    command: (runtimeId, command) => invoke('agent:command', runtimeId, command),
    stop: (runtimeId) => invoke('agent:stop', runtimeId),
    list: () => invoke('agent:list'),
    onEvent: (callback) => subscribe<AgentEventEnvelope>('agent:event', callback),
  },
  providers: {
    catalog: (force, harness) => invoke('providers:catalog', force, harness),
    setEnabled: (providerId, enabled, harness) => invoke('providers:set-enabled', providerId, enabled, harness),
    setDisabled: (providerIds, harness) => invoke('providers:set-disabled', providerIds, harness),
    setModelEnabled: (modelKey, enabled, harness) => invoke('providers:set-model-enabled', modelKey, enabled, harness),
  },
  voice: {
    credentialStatus: () => invoke('voice:credential-status'),
    saveApiKey: (provider, apiKey) => invoke('voice:save-api-key', provider, apiKey),
    deleteApiKey: (provider) => invoke('voice:delete-api-key', provider),
    createRealtimeCall: (request) => invoke('voice:create-realtime-call', request),
    transcribe: (request) => invoke('voice:transcribe', request),
    testSelfHosted: (request) => invoke('voice:test-self-hosted', request),
    executeTool: (request, harness) => invoke('voice:execute-tool', request, harness),
  },
  pets: {
    list: () => invoke('pets:list'),
    sprite: (id) => invoke('pets:sprite', id),
  },
  terminal: {
    create: (options) => invoke('terminal:create', options),
    bindSession: (terminalId, sessionPath) => invoke('terminal:bind-session', terminalId, sessionPath),
    input: (terminalId, data) => {
      ipcRenderer.send('terminal:input', terminalId, data)
    },
    resize: (terminalId, cols, rows) => {
      ipcRenderer.send('terminal:resize', terminalId, cols, rows)
    },
    setActiveContext: (terminalId, context) => {
      ipcRenderer.send('terminal:set-active-context', terminalId, context)
    },
    clearActiveContext: (terminalId) => {
      ipcRenderer.send('terminal:clear-active-context', terminalId)
    },
    kill: (terminalId) => invoke('terminal:kill', terminalId),
    onData: (callback) => subscribe<TerminalDataEvent>('terminal:data', callback),
    onExit: (callback) => subscribe<TerminalExitEvent>('terminal:exit', callback),
  },
  git: {
    status: (cwd) => invoke('git:status', cwd),
    diff: (cwd, path, staged) => invoke('git:diff', cwd, path, staged),
    stage: (cwd, paths) => invoke('git:stage', cwd, paths),
    unstage: (cwd, paths) => invoke('git:unstage', cwd, paths),
    restore: (cwd, paths) => invoke('git:restore', cwd, paths),
    commit: (cwd, message) => invoke('git:commit', cwd, message),
    push: (cwd) => invoke('git:push', cwd),
    aheadCommits: (cwd) => invoke('git:ahead-commits', cwd),
    undoCommit: (cwd, hash) => invoke('git:undo-commit', cwd, hash),
    branches: (cwd) => invoke('git:branches', cwd),
    switchBranch: (cwd, branch) => invoke('git:switch-branch', cwd, branch),
  },
  plugins: {
    list: (projectPath, harness) => invoke('plugins:list', projectPath, harness),
    install: (source, harness) => invoke('plugins:install', source, harness),
    installExtension: (input, harness) => invoke('plugins:install-extension', input, harness),
    setMcpSupport: (enabled, harness) => invoke('plugins:set-mcp-support', enabled, harness),
    connectMcp: (input, harness) => invoke('plugins:connect-mcp', input, harness),
    setMcpEnabled: (input, harness) => invoke('plugins:set-mcp-enabled', input, harness),
    mutateCapability: (input, harness) => invoke('plugins:mutate-capability', input, harness),
    refresh: (harness) => invoke('plugins:refresh', harness),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    resetBrowserData: () => invoke('settings:reset-browser-data'),
  },
  browser: {
    state: () => invoke('browser:state'),
    attachTab: (tabId, webContentsId) => invoke('browser:attach-tab', tabId, webContentsId),
    selectTab: (tabId) => invoke('browser:select-tab', tabId),
    closeTab: (tabId) => invoke('browser:close-tab', tabId),
    setPreviewContext: (webContentsId, sessionFile) => invoke('browser:set-preview-context', webContentsId, sessionFile),
    navigateTab: (tabId, action, url) => invoke('browser:navigate-tab', tabId, action, url),
    onChanged: (callback) => subscribe<AgentBrowserState>('browser:changed', callback),
    onPointer: (callback) => subscribe<AgentBrowserPointerEvent>('browser:pointer', callback),
    onActivity: (callback) => subscribe<AgentBrowserActivityEvent>('browser:activity', callback),
  },
  schedules: {
    list: (harness) => invoke('schedules:list', harness),
    get: (id) => invoke('schedules:get', id),
    preview: (timing, count) => invoke('schedules:preview', timing, count),
    create: (input, harness) => invoke('schedules:create', input, harness),
    update: (id, patch) => invoke('schedules:update', id, patch),
    pause: (id) => invoke('schedules:pause', id),
    resume: (id) => invoke('schedules:resume', id),
    delete: (id) => invoke('schedules:delete', id),
    runNow: (id) => invoke('schedules:run-now', id),
    onChanged: (callback) => subscribe<ScheduleChangeEvent>('schedules:changed', callback),
    onFocusRequested: (callback) => subscribe<{ taskId: string }>('schedules:focus', callback),
  },
}

for (const domain of Object.values(api)) Object.freeze(domain)
contextBridge.exposeInMainWorld('ptx', Object.freeze(api))
