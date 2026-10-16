import { vi } from 'vitest'

// Windows cannot execute the POSIX shebangs used by these CLI fixtures.
// Keep the real child process and stdio transport, but launch fixture scripts
// through the current Node executable rather than a command shell.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    spawn: ((file: string, args: readonly string[], options: import('node:child_process').SpawnOptions) => {
      if (process.platform === 'win32' && /\.cjs$/i.test(file)) return original.spawn(process.execPath, [file, ...args], options)
      return original.spawn(file, args, options)
    }) as typeof original.spawn,
  }
})
