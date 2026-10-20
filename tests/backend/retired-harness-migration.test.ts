import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { defaultSettings, JsonStateStore } from '../../electron/main/store'

it('backs up retired Prime state once, preserves Pi/OMP, and never reassigns grants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ptx-retirement-'))
  const path = join(root, 'state.json')
  const project = { id: 'old', harness: 'prime', name: 'old', path: root, folders: [root], primaryFolder: root }
  const original = JSON.stringify({ version: 4, projects: [project, { ...project, id: 'pi', harness: 'pi' }, { ...project, id: 'omp', harness: 'omp' }], settings: { ...defaultSettings(), activeHarness: 'prime', disabledProviders: ['old'], runtimePaths: { prime: '/old/cli', pi: '', omp: '' } }, schedules: [], archivedSessions: ['keep'], dismissedProjectPaths: [] })
  writeFileSync(path, original)
  try {
    const store = new JsonStateStore(path)
    await store.ready()
    expect(store.snapshot().projects.map(item => item.harness)).toEqual(['pi', 'omp'])
    expect(store.snapshot().archivedSessions).toEqual(['keep'])
    expect(store.getSettings().activeHarness).toBe('omp')
    const backups = readdirSync(root).filter(name => name.includes('.removed-prime-'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(root, backups[0]), 'utf8')).toBe(original)
    await store.beginShutdown()
    const reopened = new JsonStateStore(path)
    await reopened.ready()
    expect(readdirSync(root).filter(name => name.includes('.removed-prime-'))).toEqual(backups)
    expect(readFileSync(path, 'utf8')).not.toContain('"prime"')
    await reopened.beginShutdown()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
