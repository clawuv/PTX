import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettings, JsonStateStore } from '../../electron/main/store'
import type { DesktopState } from '../../electron/main/store'

const dirs: string[] = []
const stores: JsonStateStore[] = []
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.beginShutdown())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function loadState(value: unknown): DesktopState {
  const dir = mkdtempSync(join(tmpdir(), 'ptx-store-parse-'))
  dirs.push(dir)
  const path = join(dir, 'state.json')
  writeFileSync(path, JSON.stringify(value))
  const store = new JsonStateStore(path)
  stores.push(store)
  return store.snapshot()
}

const validSchedule = {
  schemaVersion: 1,
  id: 'schedule-1',
  harness: 'omp',
  revision: 2,
  title: 'Nightly triage',
  prompt: 'Review open issues',
  target: { kind: 'project', projectId: 'project-1' },
  timing: { kind: 'once', at: '2026-01-01T09:00:00.000Z' },
  execution: { model: 'auto', thinking: 'auto', speed: 'normal' },
  status: 'active',
  createdBy: 'user',
  createdAt: '2025-12-01T09:00:00.000Z',
  updatedAt: '2025-12-02T09:00:00.000Z',
  runs: [],
}

const validRun = {
  id: 'run-1',
  taskId: 'schedule-1',
  taskRevision: 1,
  trigger: 'scheduled',
  scheduledFor: '2026-01-01T09:00:00.000Z',
  queuedAt: '2026-01-01T09:00:01.000Z',
  status: 'succeeded',
  execution: { model: 'gpt-5', thinking: 'high', speed: 'fast' },
}

describe('persisted project parsing', () => {
  it('keeps well-formed projects and repairs missing optional fields', () => {
    const { projects } = loadState({
      version: 3,
      projects: [{
        id: 'project-1',
        harness: 'omp',
        name: 'Ptx',
        path: '/repos/pi-studio',
        primaryFolder: '/repos/pi-studio',
        pinned: 'yes',
        createdAt: 'not a date',
        lastOpenedAt: '2025-12-02T09:00:00.000Z',
      }],
    })
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ harness: 'omp', folders: ['/repos/pi-studio'], pinned: false, lastOpenedAt: '2025-12-02T09:00:00.000Z' })
    expect(Number.isFinite(Date.parse(projects[0].createdAt))).toBe(true)
    expect(projects[0].folderIdentities).toBeUndefined()
  })

  it('drops projects that are not records or lack an id, name, path, folders, or primary folder', () => {
    expect(loadState({ version: 3, projects: ['project-1', null] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n' }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n', path: '/repo', folders: [], primaryFolder: '/repo' }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: [{ id: 'p', name: 'n', path: '/repo', folders: ['/repo'] }] }).projects).toEqual([])
    expect(loadState({ version: 3, projects: { id: 'p' } }).projects).toEqual([])
  })

  it('preserves the hidden flag across relaunch and rejects non-boolean values', () => {
    const { projects } = loadState({
      version: 3,
      projects: [
        { id: 'hidden-1', harness: 'omp', name: 'Hidden', path: '/repos/hidden', primaryFolder: '/repos/hidden', hidden: true },
        { id: 'visible-1', harness: 'omp', name: 'Visible', path: '/repos/visible', primaryFolder: '/repos/visible' },
        { id: 'garbage-1', harness: 'omp', name: 'Garbage', path: '/repos/garbage', primaryFolder: '/repos/garbage', hidden: 'yes' },
      ],
    })
    expect(projects.find((project) => project.id === 'hidden-1')?.hidden).toBe(true)
    expect(projects.find((project) => project.id === 'visible-1')?.hidden).toBeUndefined()
    expect(projects.find((project) => project.id === 'garbage-1')?.hidden).toBeUndefined()
  })

  it('keeps only folder identities with string device and inode numbers and a plausible birth time', () => {
    const { projects } = loadState({
      version: 3,
      projects: [{
        id: 'project-1',
        harness: 'omp',
        name: 'Ptx',
        path: '/repos/pi-studio',
        folders: ['/repos/pi-studio', 7],
        primaryFolder: '/repos/pi-studio',
        folderIdentities: {
          '/repos/pi-studio': { dev: '1', ino: '2', birthtimeNs: '1700000000000000000' },
          '/repos/other': { dev: '1', ino: '3', birthtimeNs: 'yesterday' },
          '/repos/third': { dev: 1, ino: 3 },
          '/repos/fourth': 'identity',
        },
      }],
    })
    expect(projects[0].folders).toEqual(['/repos/pi-studio'])
    expect(projects[0].folderIdentities).toEqual({
      '/repos/pi-studio': { dev: '1', ino: '2', birthtimeNs: '1700000000000000000' },
      '/repos/other': { dev: '1', ino: '3', birthtimeNs: undefined },
    })
  })

  it.each([1, 2])('migrates only absent harnesses from recognized pre-harness version %s to Prime', (version) => {
    const legacyProject = {
      id: 'legacy-project',
      name: 'Legacy',
      path: '/repos/legacy',
      folders: ['/repos/legacy'],
      primaryFolder: '/repos/legacy',
    }
    const { projects } = loadState({
      version,
      projects: [legacyProject, { ...legacyProject, id: 'unknown-project', harness: 'future-harness' }],
    })

    expect(projects).toEqual([])
  })

  it.each([3, 4])('drops version %s projects whose harness is absent or unknown', (version) => {
    const project = {
      id: 'project-1',
      name: 'Ptx',
      path: '/repos/pi-studio',
      folders: ['/repos/pi-studio'],
      primaryFolder: '/repos/pi-studio',
    }
    const { projects } = loadState({
      version,
      projects: [project, { ...project, id: 'unknown-project', harness: 'future-harness' }, { ...project, id: 'prime-project', harness: 'omp' }],
    })

    expect(projects.map(({ id, harness }) => ({ id, harness }))).toEqual([{ id: 'prime-project', harness: 'omp' }])
  })
  it('bounds project scripts and preserves setup execution state', () => {
    const project = {
      id: 'project-1',
      harness: 'omp',
      name: 'Ptx',
      path: '/repos/pi-studio',
      folders: ['/repos/pi-studio'],
      primaryFolder: '/repos/pi-studio',
      scripts: { setup: 'npm install', run: 'npm run dev', setupLastRun: 'npm install', setupLastExitCode: 0 },
    }
    expect(loadState({ version: 4, projects: [project] }).projects[0].scripts).toEqual(project.scripts)
    expect(loadState({ version: 4, projects: [{ ...project, scripts: { setup: 'bad\0setup', run: 7, setupLastRun: 'x'.repeat(70_000), setupLastExitCode: 'bad' } }] }).projects[0].scripts).toEqual({
      setup: '',
      run: '',
      setupLastRun: undefined,
      setupLastExitCode: undefined,
    })
    expect(loadState({ version: 4, projects: [{ ...project, scripts: { ...project.scripts, setupLastExitCode: -1 } }] }).projects[0].scripts).toEqual({
      ...project.scripts,
      setupLastExitCode: -1,
    })
    expect(loadState({ version: 4, projects: [{ ...project, scripts: { ...project.scripts, setupLastExitCode: undefined } }] }).projects[0].scripts).toEqual({
      ...project.scripts,
      setupLastRun: undefined,
      setupLastExitCode: undefined,
    })
  })

})

describe('persisted settings parsing', () => {
  it('falls back to defaults when settings are missing or not a record', () => {
    expect(loadState({ version: 3 }).settings).toEqual(defaultSettings())
    expect(loadState({ version: 3, settings: 'dark' }).settings).toEqual(defaultSettings())
    expect(loadState('not a state').settings).toEqual(defaultSettings())
  })

  it('keeps only absolute, bounded runtime paths and known harness identifiers', () => {
    const { settings } = loadState({
      version: 3,
      settings: { runtimePaths: { prime: '/usr/local/bin/prime', omp: 'omp', pi: '/'.padEnd(4_097, 'x') }, enabledHarnesses: ['omp', 'omp', 'ollama'], activeHarness: 'ollama' },
    })
    expect(settings.runtimePaths).toEqual({ omp: '', pi: '' })
    expect(settings.enabledHarnesses).toEqual(['omp'])
    expect(settings.activeHarness).toBe('omp')
  })

  it('defaults background behavior off and preserves valid opt-in values', () => {
    expect(loadState({ version: 4, settings: {} }).settings).toMatchObject({
      keepRunningInBackground: false,
      launchAtLogin: false,
    })
    expect(loadState({ version: 4, settings: { keepRunningInBackground: true, launchAtLogin: true } }).settings).toMatchObject({
      keepRunningInBackground: true,
      launchAtLogin: true,
    })
    expect(loadState({ version: 4, settings: { keepRunningInBackground: 'yes', launchAtLogin: 1 } }).settings).toMatchObject({
      keepRunningInBackground: false,
      launchAtLogin: false,
    })
  })

  it('filters disabled provider and model identifiers to their documented shapes', () => {
    const { settings } = loadState({
      version: 3,
      settings: {
        ompDisabledProviders: ['openai', 'openai', '-bad', 42],
        ompDisabledModels: ['openai/gpt-5', 'gpt-5', 7],
        piDisabledProviders: 'openai',
        piDisabledModels: ['openai/gpt-5'],
      },
    })
    expect(settings.ompDisabledProviders).toEqual(['openai'])
    expect(settings.ompDisabledModels).toEqual(['openai/gpt-5'])
    expect(settings.piDisabledProviders).toEqual([])
    expect(settings.piDisabledModels).toEqual(['openai/gpt-5'])
  })

  it('keeps valid per-harness model preferences and clears malformed entries', () => {
    const { settings } = loadState({
      version: 4,
      settings: {
        lastSelectedModels: {
              omp: 'missing-slash',
          pi: 'anthropic/claude-sonnet-4',
        },
      },
    })
    expect(settings.lastSelectedModels).toEqual({
      omp: '',
      pi: 'anthropic/claude-sonnet-4',
    })
  })

  it('keeps well-formed reasoning defaults and drops hostile map entries', () => {
    const { settings } = loadState({
      version: 4,
      settings: {
        modelEffort: {
          omp: { 'anthropic/claude-sonnet-4': 'high', '..': 'low', 'openai/gpt': 'turbo' },
          pi: 'not-a-map',
        },
      },
    })
    expect(settings.modelEffort).toEqual({ omp: { 'anthropic/claude-sonnet-4': 'high' }, pi: {} })
  })

  it('defaults the reasoning map when the persisted state predates it', () => {
    const { settings } = loadState({ version: 4, settings: {} })
    expect(settings.modelEffort).toEqual({ omp: {}, pi: {} })
  })
})

describe('persisted schedule parsing', () => {
  it('keeps a well-formed schedule and drops an unknown harness', () => {
    const { schedules } = loadState({ version: 3, schedules: [validSchedule, { ...validSchedule, id: 'schedule-2', harness: 'unknown' }] })
    expect(schedules).toHaveLength(1)
    expect(schedules[0]).toMatchObject({ id: 'schedule-1', harness: 'omp', revision: 2, runs: [] })
  })

  it('drops retired unscoped version 2 schedules', () => {
    const { harness: _harness, ...legacySchedule } = validSchedule
    const { schedules } = loadState({ version: 2, schedules: [legacySchedule, { ...legacySchedule, id: 'unknown-schedule', harness: 'future-harness' }] })

    expect(schedules).toEqual([])
  })

  it('ignores every schedule in version 1, which predates schedules', () => {
    const { harness: _harness, ...missingHarness } = validSchedule
    expect(loadState({ version: 1, schedules: [missingHarness, validSchedule] }).schedules).toEqual([])
  })

  it.each([3, 4])('drops version %s schedules whose harness is absent or unknown', (version) => {
    const { harness: _harness, ...missingHarness } = validSchedule
    const { schedules } = loadState({
      version,
      schedules: [missingHarness, { ...validSchedule, id: 'unknown-schedule', harness: 'future-harness' }, validSchedule],
    })

    expect(schedules.map(({ id, harness }) => ({ id, harness }))).toEqual([{ id: 'schedule-1', harness: 'omp' }])
  })

  it('drops schedules with an unusable envelope, status, or authorship', () => {
    const drops = [
      'schedule-1',
      { ...validSchedule, schemaVersion: 2 },
      { ...validSchedule, id: '' },
      { ...validSchedule, revision: 0 },
      { ...validSchedule, revision: 1.5 },
      { ...validSchedule, title: '   ' },
      { ...validSchedule, prompt: '' },
      { ...validSchedule, status: 'running' },
      { ...validSchedule, createdBy: 'system' },
      { ...validSchedule, createdAt: 'yesterday' },
      { ...validSchedule, updatedAt: 'tomorrow' },
    ]
    for (const schedule of drops) expect(loadState({ version: 3, schedules: [schedule] }).schedules).toEqual([])
    expect(loadState({ version: 3, schedules: 'none' }).schedules).toEqual([])
  })

  it('drops schedules whose target, timing, or execution is unusable', () => {
    const drops = [
      { target: { kind: 'project' } },
      { target: { kind: 'session', projectId: 'project-1' } },
      { target: { kind: 'workspace', projectId: 'project-1' } },
      { target: 'project-1' },
      { timing: { kind: 'once', at: 'soon' } },
      { timing: { kind: 'rrule', dtstartLocal: '2026-01-01T09:00:00', timeZone: 'UTC' } },
      { timing: { kind: 'weekly', at: '2026-01-01T09:00:00.000Z' } },
      { timing: 'once' },
      { execution: { model: '', thinking: 'auto', speed: 'normal' } },
      { execution: { model: 'auto', thinking: 'ludicrous', speed: 'normal' } },
      { execution: { model: 'auto', thinking: 'auto', speed: 'slow' } },
      { execution: 'auto' },
    ]
    for (const patch of drops) expect(loadState({ version: 3, schedules: [{ ...validSchedule, ...patch }] }).schedules).toEqual([])
  })

  it('keeps a session target, an rrule timing, and the optional schedule fields', () => {
    const { schedules } = loadState({
      version: 3,
      schedules: [{
        ...validSchedule,
        target: { kind: 'session', projectId: 'project-1', sessionId: 'session-1' },
        timing: { kind: 'rrule', dtstartLocal: '2026-01-01T09:00:00', timeZone: 'America/New_York', rrule: 'FREQ=DAILY' },
        status: 'blocked',
        nextRunAt: '2026-01-02T09:00:00.000Z',
        blockedReason: 'The project folder is missing',
      }],
    })
    expect(schedules[0]).toMatchObject({
      target: { kind: 'session', projectId: 'project-1', sessionId: 'session-1' },
      timing: { kind: 'rrule', dtstartLocal: '2026-01-01T09:00:00', timeZone: 'America/New_York', rrule: 'FREQ=DAILY' },
      nextRunAt: '2026-01-02T09:00:00.000Z',
      blockedReason: 'The project folder is missing',
    })
    expect(loadState({ version: 3, schedules: [{ ...validSchedule, nextRunAt: 'soon', blockedReason: 7 }] }).schedules[0]).toMatchObject({ nextRunAt: undefined, blockedReason: undefined })
  })

  it('keeps well-formed runs with their optional fields and drops malformed ones', () => {
    const { schedules } = loadState({
      version: 3,
      schedules: [{
        ...validSchedule,
        runs: [
          { ...validRun, startedAt: '2026-01-01T09:00:02.000Z', finishedAt: '2026-01-01T09:01:00.000Z', sessionId: 'session-1', sessionFile: '/sessions/session-1.jsonl', error: 'transient failure', skippedCount: 3 },
          { ...validRun, id: 'run-2', startedAt: 'soon', finishedAt: 7, sessionId: '', sessionFile: 7, error: 7, skippedCount: 0 },
          { ...validRun, id: 'run-3', status: 'cancelled', finishedAt: '2026-01-01T09:00:03.000Z', error: 'Task changed' },
          'run-4',
          { ...validRun, taskRevision: 0 },
          { ...validRun, status: 'abandoned' },
          { ...validRun, trigger: 'heartbeat' },
          { ...validRun, scheduledFor: 'soon' },
          { ...validRun, queuedAt: 'soon' },
          { ...validRun, execution: { model: 'gpt-5', thinking: 'high', speed: 'warp' } },
        ],
      }],
    })
    expect(schedules[0].runs.map((run) => run.id)).toEqual(['run-1', 'run-2', 'run-3'])
    expect(schedules[0].runs[0]).toMatchObject({ startedAt: '2026-01-01T09:00:02.000Z', finishedAt: '2026-01-01T09:01:00.000Z', sessionId: 'session-1', sessionFile: '/sessions/session-1.jsonl', error: 'transient failure', skippedCount: 3 })
    expect(schedules[0].runs[1]).toMatchObject({ startedAt: undefined, finishedAt: undefined, sessionId: undefined, sessionFile: undefined, error: undefined, skippedCount: undefined })
    expect(schedules[0].runs[2]).toMatchObject({ status: 'cancelled', finishedAt: '2026-01-01T09:00:03.000Z', error: 'Task changed' })
    expect(loadState({ version: 3, schedules: [{ ...validSchedule, runs: 'none' }] }).schedules[0].runs).toEqual([])
  })

  it('keeps retry lineage and failure counters, rejecting out-of-range values', () => {
    const { schedules } = loadState({
      version: 3,
      schedules: [{
        ...validSchedule,
        consecutiveFailures: 2,
        runs: [
          { ...validRun, trigger: 'retry', attempt: 2, retryOfRunId: 'run-0' },
          { ...validRun, id: 'run-5', attempt: 1 },
          { ...validRun, id: 'run-6', attempt: 100 },
          { ...validRun, id: 'run-7', retryOfRunId: 7 },
        ],
      }, { ...validSchedule, id: 'schedule-bad', consecutiveFailures: -1 }],
    })
    expect(schedules[0].consecutiveFailures).toBe(2)
    expect(schedules[0].runs[0]).toMatchObject({ trigger: 'retry', attempt: 2, retryOfRunId: 'run-0' })
    // attempt 1 is stored as undefined; values outside 2..99 and non-string lineage drop.
    expect(schedules[0].runs[1]).toMatchObject({ attempt: undefined, retryOfRunId: undefined })
    expect(schedules[0].runs[2]).toMatchObject({ attempt: undefined })
    expect(schedules[0].runs[3]).toMatchObject({ retryOfRunId: undefined })
    // An invalid counter drops the field, not the whole task.
    expect(schedules[1]).toMatchObject({ id: 'schedule-bad', consecutiveFailures: undefined })
  })

  it('caps stored schedules', () => {
    const { schedules } = loadState({
      version: 3,
      schedules: Array.from({ length: 501 }, (_, index) => ({
        ...validSchedule,
        id: `schedule-${index}`,
      })),
    })
    expect(schedules).toHaveLength(500)
    expect(schedules[0].id).toBe('schedule-0')
  })
})
