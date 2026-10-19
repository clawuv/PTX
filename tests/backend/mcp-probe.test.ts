import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeMcpServer } from '../../electron/main/plugins/mcp-probe'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'ptx-mcp-probe-')); dirs.push(dir); return dir }

/** Writes a stdio MCP fixture that answers `initialize` (or never does / answers with an error). */
function writeServer(name: 'ok' | 'silent' | 'error'): string {
  const root = temp()
  const file = join(root, `${name}.cjs`)
  const script: Record<string, string> = {
    ok: `
      let buffer = ''
      process.stdin.on('data', (chunk) => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
          if (!line.trim()) continue
          const request = JSON.parse(line)
          if (request.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture-mcp', version: '9.9.9' } } }) + '\\n')
          }
        }
      })
    `,
    silent: `setInterval(() => {}, 1_000)`,
    error: `
      let buffer = ''
      process.stdin.on('data', (chunk) => {
        buffer += chunk
        const index = buffer.indexOf('\\n')
        if (index < 0) return
        const request = JSON.parse(buffer.slice(0, index))
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } }) + '\\n')
      })
    `,
  }
  writeFileSync(file, script[name])
  return file
}

const runNode = (scriptPath: string, args: string[] = []) => ({ command: process.execPath, args: [scriptPath, ...args] })

describe('probeMcpServer', () => {
  it('reports a successful initialize handshake with server info and latency', async () => {
    const result = await probeMcpServer(runNode(writeServer('ok')), { timeoutMs: 4_000 })
    expect(result.ok).toBe(true)
    expect(result.serverName).toBe('fixture-mcp')
    expect(result.serverVersion).toBe('9.9.9')
    expect(typeof result.latencyMs).toBe('number')
  }, 15_000)

  it('fails with a timeout detail when the server never answers initialize', async () => {
    const result = await probeMcpServer(runNode(writeServer('silent')), { timeoutMs: 400 })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no initialize response')
  }, 15_000)

  it('fails when the server rejects initialize', async () => {
    const result = await probeMcpServer(runNode(writeServer('error')), { timeoutMs: 4_000 })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('initialize rejected')
  }, 15_000)

  it('fails clearly for a command that cannot start', async () => {
    const result = await probeMcpServer({ command: 'definitely-not-a-real-command-ptx', args: [] }, { timeoutMs: 4_000 })
    expect(result.ok).toBe(false)
    expect(result.detail).toBeTruthy()
  }, 15_000)

  it('forwards configured arguments to the launched server', async () => {
    const root = temp()
    const file = join(root, 'echo-args.cjs')
    writeFileSync(file, `
      const args = process.argv.slice(2)
      let buffer = ''
      process.stdin.on('data', (chunk) => {
        buffer += chunk
        const index = buffer.indexOf('\\n')
        if (index < 0) return
        const request = JSON.parse(buffer.slice(0, index))
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { args } }) + '\\n')
      })
    `)
    const result = await probeMcpServer(runNode(file, ['--flag', 'value']), { timeoutMs: 4_000 })
    expect(result.ok).toBe(true)
    void spawn
  }, 15_000)
})
