import { describe, expect, it } from 'vitest'
import { createOpenWithService, type OpenWithTargetId } from '../../electron/main/open-with'

interface Fixture {
  exists: Set<string>
  launched: Array<{ executable: string; folder: string }>
  openedFolders: string[]
  platform: NodeJS.Platform
  pathEnv: string
  home: string
}

function service(fixture: Fixture) {
  return createOpenWithService({
    platform: fixture.platform,
    pathEnv: fixture.pathEnv,
    home: fixture.home,
    probeExecutable: async (path) => fixture.exists.has(path),
    launchEditor: (executable, folder) => fixture.launched.push({ executable, folder }),
    openFolder: (folder) => fixture.openedFolders.push(folder),
  })
}

const WINDOWS_PATH = 'C:\\Tools;C:\\Windows'
const UNIX_PATH = '/usr/local/bin:/usr/bin'

describe('open-with service', () => {
  it('reports the file explorer as always available and editors from known install paths', async () => {
    const fixture: Fixture = {
      exists: new Set(['C:\\Program Files\\Microsoft VS Code\\Code.exe']),
      launched: [],
      openedFolders: [],
      platform: 'win32',
      pathEnv: WINDOWS_PATH,
      home: 'C:\\Users\\u',
    }
    const targets = await service(fixture).targets()
    expect(targets).toEqual([
      { id: 'explorer', available: true },
      { id: 'vscode', available: true },
      { id: 'cursor', available: false },
    ])
  })

  it('finds editors through PATH directories', async () => {
    const fixture: Fixture = {
      exists: new Set(['/usr/local/bin/cursor']),
      launched: [],
      openedFolders: [],
      platform: 'linux',
      pathEnv: UNIX_PATH,
      home: '/home/u',
    }
    const targets = await service(fixture).targets()
    expect(targets.filter((target) => target.available).map((target) => target.id)).toEqual(['explorer', 'cursor'])
  })

  it('launches a resolved editor with a fixed argv array and no shell', async () => {
    const fixture: Fixture = {
      exists: new Set(['/usr/local/bin/code']),
      launched: [],
      openedFolders: [],
      platform: 'linux',
      pathEnv: UNIX_PATH,
      home: '/home/u',
    }
    await service(fixture).open('vscode', '/granted/project')
    expect(fixture.launched).toEqual([{ executable: '/usr/local/bin/code', folder: '/granted/project' }])
    expect(fixture.openedFolders).toEqual([])
  })

  it('opens the folder through the system file manager for the explorer target', async () => {
    const fixture: Fixture = {
      exists: new Set(),
      launched: [],
      openedFolders: [],
      platform: 'win32',
      pathEnv: WINDOWS_PATH,
      home: 'C:\\Users\\u',
    }
    await service(fixture).open('explorer', 'E:\\granted project')
    expect(fixture.openedFolders).toEqual(['E:\\granted project'])
    expect(fixture.launched).toEqual([])
  })

  it('throws when an editor target has no installation', async () => {
    const fixture: Fixture = {
      exists: new Set(),
      launched: [],
      openedFolders: [],
      platform: 'darwin',
      pathEnv: UNIX_PATH,
      home: '/Users/u',
    }
    await expect(service(fixture).open('cursor' as OpenWithTargetId, '/granted/project')).rejects.toThrow('cursor')
    expect(fixture.launched).toEqual([])
  })

  it('keeps window and user-scope editor installs resolvable on Windows', async () => {
    const fixture: Fixture = {
      exists: new Set(['C:\\Users\\u\\AppData\\Local\\Programs\\cursor\\Cursor.exe', 'D:\\Editor\\bin\\Code.exe']),
      launched: [],
      openedFolders: [],
      platform: 'win32',
      pathEnv: 'D:\\Editor\\bin',
      home: 'C:\\Users\\u',
    }
    const targets = await service(fixture).targets()
    expect(targets.filter((target) => target.available).map((target) => target.id)).toEqual(['explorer', 'vscode', 'cursor'])
  })
})
