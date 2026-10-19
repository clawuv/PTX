import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { McpProbeResult } from '../../../src/types/api'
import { killProcessTree, prepareExecutableSpawn, safeChildEnvironment, waitForProcessExit } from '../process-utils'

/**
 * Connectivity probe for local stdio MCP definitions. Launches the configured
 * server exactly like a harness client would (argv array, no shell), performs
 * one JSON-RPC `initialize` handshake over newline-delimited JSON, and tears
 * the process tree down again. The definition always comes from the harness
 * settings files; the renderer only ever supplies a reference.
 */

const DEFAULT_TIMEOUT_MS = 8_000
const MIN_TIMEOUT_MS = 250
const MAX_TIMEOUT_MS = 20_000
const MAX_STDIO_BYTES = 64 * 1024

export interface McpProbeTarget {
  command: string
  args?: readonly string[]
}

export interface McpProbeOptions {
  timeoutMs?: number
  protocolVersion?: string
  clientName?: string
  clientVersion?: string
}

interface SpawnInvocation {
  file: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

const isWindows = process.platform === 'win32'
const pathDirectories = (env: NodeJS.ProcessEnv): string[] => (env.PATH ?? env.Path ?? '')
  .split(delimiter)
  .filter((directory) => directory.trim().length > 0)

const executableVariants = (command: string): string[] => {
  if (/\.exe$/i.test(command)) return [command]
  if (/\.cmd$|\.bat$/i.test(command)) return [command]
  return [`${command}.exe`, command, `${command}.cmd`, `${command}.bat`]
}

/** Bare command names on Windows need explicit PATH resolution: CreateProcess only finds .exe. */
function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const directory of pathDirectories(env)) {
    for (const candidate of executableVariants(command)) {
      const resolved = join(directory, candidate)
      try {
        if (existsSync(resolved) && statSync(resolved).isFile()) return resolved
      } catch { /* unreadable directory entries are skipped */ }
    }
  }
  return undefined
}

/** cmd.exe invocation for npm-style .cmd shims; argv is pre-joined because cmd parses one line. */
function cmdShimInvocation(resolved: string, args: readonly string[], env: NodeJS.ProcessEnv): SpawnInvocation {
  const comspec = env.ComSpec ?? `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`
  const quoted = [resolved, ...args].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')
  return { file: comspec, args: ['/d', '/s', '/c', quoted], windowsVerbatimArguments: true }
}

function resolveSpawnInvocation(command: string, args: readonly string[]): SpawnInvocation {
  const env = safeChildEnvironment()
  const direct = prepareExecutableSpawn(command, args, env)
  if (!isWindows) return direct
  const hasDirectoryPart = /[\\/]/.test(command)
  const isShimScript = /\.cmd$|\.bat$/i.test(command)
  if (hasDirectoryPart || !isShimScript) return direct
  // Bare non-exe command (typically `npx`): CreateProcess cannot run .cmd shims
  // without a shell, so resolve the real shim on PATH and hand it to cmd.exe.
  const resolved = resolveWindowsCommand(command, env)
  if (!resolved) return direct
  if (/\.cmd$|\.bat$/i.test(resolved)) return cmdShimInvocation(resolved, args, env)
  return { file: resolved, args: [...args] }
}

function spawnDetail(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return 'command was not found'
  if (code === 'EACCES') return 'command is not executable'
  return `could not start command${code ? ` (${code})` : ''}`
}

function decodeTail(buffer: Buffer, max = 4000): string {
  return buffer.toString('utf8', Math.max(0, buffer.length - max)).trim().slice(0, max)
}

export async function probeMcpServer(target: McpProbeTarget, options: McpProbeOptions = {}): Promise<McpProbeResult> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
  const command = target.command.trim()
  if (!command) return { ok: false, detail: 'MCP definition has no command' }

  let child: ChildProcess
  let invocation: SpawnInvocation
  try {
    invocation = resolveSpawnInvocation(command, target.args ?? [])
  } catch (error) {
    return { ok: false, detail: spawnDetail(error) }
  }
  const startedAt = Date.now()
  try {
    child = spawn(invocation.file, invocation.args, {
      env: safeChildEnvironment(),
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    return { ok: false, detail: spawnDetail(error) }
  }

  return await new Promise<McpProbeResult>((resolve) => {
    let settled = false
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let pendingExit: Promise<boolean> | null = null

    const finish = (result: McpProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      void (async () => {
        if (child.pid && child.exitCode === null && !child.killed) {
          await killProcessTree(child.pid, {
            ladder: [{ signal: 'SIGTERM', waitMs: 1_000 }, { signal: 'SIGKILL', waitMs: 0 }],
            waitForExit: (waitMs) => waitForProcessExit(child, waitMs),
            signalDirect: (signal) => child.kill(signal),
          })
        }
        child.stdin?.destroy()
        child.stdout?.destroy()
        child.stderr?.destroy()
        if (pendingExit) await pendingExit
      })().catch(() => undefined).finally(() => resolve(result))
    }

    const timer = setTimeout(() => {
      finish({ ok: false, detail: `no initialize response within ${timeoutMs} ms`, latencyMs: timeoutMs })
    }, timeoutMs)

    const onError = (error: Error): void => {
      finish({ ok: false, detail: spawnDetail(error) })
    }
    child.on('error', onError)
    child.on('close', () => {
      if (!settled) finish({ ok: false, detail: `server exited before responding${stderr.length > 0 ? `: ${decodeTail(stderr)}` : ''}` })
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      if (stdout.length < MAX_STDIO_BYTES) stdout = Buffer.concat([stdout, chunk])
      for (const line of stdout.toString('utf8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed?.startsWith('{')) continue
        let parsed: unknown
        try { parsed = JSON.parse(trimmed) } catch { continue }
        if (!parsed || typeof parsed !== 'object' || (parsed as { id?: unknown }).id !== 1) continue
        const response = parsed as { result?: { serverInfo?: { name?: unknown; version?: unknown } }; error?: { message?: unknown } }
        const latencyMs = Date.now() - startedAt
        if (response.error) {
          finish({ ok: false, detail: `initialize rejected: ${String(response.error.message ?? 'unknown error')}`, latencyMs })
          return
        }
        if (response.result) {
          const serverName = typeof response.result.serverInfo?.name === 'string' ? response.result.serverInfo.name : undefined
          const serverVersion = typeof response.result.serverInfo?.version === 'string' ? response.result.serverInfo.version : undefined
          finish({ ok: true, latencyMs, ...(serverName ? { serverName } : {}), ...(serverVersion ? { serverVersion } : {}) })
          return
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDIO_BYTES) stderr = Buffer.concat([stderr, chunk])
    })

    pendingExit = waitForProcessExit(child, timeoutMs + 1_000).catch(() => false)
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: options.protocolVersion ?? '2024-11-05',
        capabilities: {},
        clientInfo: { name: options.clientName ?? 'Ptx', version: options.clientVersion ?? '1.0.0' },
      },
    }
    try { child.stdin?.write(`${JSON.stringify(request)}\n`) } catch { /* a failed pipe surfaces through close/error */ }
  })
}
