import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export type OpenWithTargetId = 'explorer' | 'vscode' | 'cursor'

export const OPEN_WITH_TARGET_IDS: readonly OpenWithTargetId[] = ['explorer', 'vscode', 'cursor']

export function isOpenWithTargetId(value: unknown): value is OpenWithTargetId {
  return typeof value === 'string' && (OPEN_WITH_TARGET_IDS as readonly string[]).includes(value)
}

interface EditorProbe {
  kind: Exclude<OpenWithTargetId, 'explorer'>
  /** Absolute executables probed before the PATH scan (known install locations). */
  candidates(platform: NodeJS.Platform, home: string, pathJoin: typeof posix.join): string[]
  /** Executable file names searched for in every PATH directory. */
  pathNames(platform: NodeJS.Platform): string[]
}

const EDITORS: Record<Exclude<OpenWithTargetId, 'explorer'>, EditorProbe> = {
  vscode: {
    kind: 'vscode',
    candidates: (platform, home, pathJoin) => {
      if (platform === 'win32') {
        const local = pathJoin(home, 'AppData', 'Local')
        return [
          pathJoin(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          pathJoin('C:', 'Program Files', 'Microsoft VS Code', 'Code.exe'),
          pathJoin('C:', 'Program Files (x86)', 'Microsoft VS Code', 'Code.exe'),
        ]
      }
      if (platform === 'darwin') {
        return [
          pathJoin('/Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
          pathJoin(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
        ]
      }
      return []
    },
    pathNames: (platform) => (platform === 'win32' ? ['Code.exe'] : ['code']),
  },
  cursor: {
    kind: 'cursor',
    candidates: (platform, home, pathJoin) => {
      if (platform === 'win32') {
        const local = pathJoin(home, 'AppData', 'Local')
        return [pathJoin(local, 'Programs', 'cursor', 'Cursor.exe'), pathJoin('C:', 'Program Files', 'cursor', 'Cursor.exe')]
      }
      if (platform === 'darwin') {
        return [pathJoin('/Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor'), pathJoin(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor')]
      }
      return []
    },
    pathNames: (platform) => (platform === 'win32' ? ['Cursor.exe'] : ['cursor']),
  },
}

export interface OpenWithService {
  /** Every target with its current availability; `explorer` is always available. */
  targets(): Promise<{ id: OpenWithTargetId; available: boolean }[]>
  /** Launches an editor (or the system file manager) on an already-authorized folder. */
  open(target: OpenWithTargetId, folder: string): Promise<void>
}

export interface OpenWithServiceDependencies {
  platform: NodeJS.Platform
  pathEnv: string
  home: string
  probeExecutable(path: string): Promise<boolean>
  launchEditor(executable: string, folder: string): void
  openFolder(folder: string): void
}

const pathDirectories = (pathEnv: string, platform: NodeJS.Platform): string[] => {
  const raw = platform === 'win32' ? pathEnv.split(';') : pathEnv.split(':')
  return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
}

/**
 * "Open with" for authorized project folders: resolves known editor installs
 * (absolute paths only) and launches them with a fixed argv array — never a
 * shell, never renderer-supplied executables.
 */
export function createOpenWithService(dependencies: OpenWithServiceDependencies): OpenWithService {
  const { platform, pathEnv, home, probeExecutable, launchEditor, openFolder } = dependencies

  const pathJoin = platform === 'win32' ? win32.join : posix.join
  const resolveEditor = async (kind: Exclude<OpenWithTargetId, 'explorer'>): Promise<string | null> => {
    const probe = EDITORS[kind]
    for (const candidate of probe.candidates(platform, home, pathJoin)) {
      if (await probeExecutable(candidate)) return candidate
    }
    const directories = pathDirectories(pathEnv, platform)
    for (const directory of directories) {
      for (const name of probe.pathNames(platform)) {
        const candidate = pathJoin(directory, name)
        if (await probeExecutable(candidate)) return candidate
      }
    }
    return null
  }

  const available = async (target: OpenWithTargetId): Promise<boolean> => {
    if (target === 'explorer') return true
    return (await resolveEditor(target)) !== null
  }

  return {
    async targets() {
      return Promise.all(OPEN_WITH_TARGET_IDS.map(async (id) => ({ id, available: await available(id) })))
    },
    async open(target, folder) {
      if (target === 'explorer') {
        openFolder(folder)
        return
      }
      const executable = await resolveEditor(target)
      if (!executable) throw new Error(`No installation found for ${target}`)
      launchEditor(executable, folder)
    },
  }
}

/** Production wiring: existence probes plus a detached, shell-free launch. */
export function createNodeOpenWithDependencies(): OpenWithServiceDependencies {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? '',
    home: homedir(),
    probeExecutable: async (path) => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    launchEditor: (executable, folder) => {
      const child = spawn(executable, [folder], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    },
    openFolder: () => {},
  }
}
