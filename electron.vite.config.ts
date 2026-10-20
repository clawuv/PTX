import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Fully minify production code: Electron never consumes readable output,
    // and less source is faster for V8 to read, parse, and compile at startup.
    build: {
      // Library mode preserves whitespace even with esbuild minification.
      rollupOptions: { input: resolve('electron/main/index.ts'), output: { entryFileNames: 'index.js' } },
      minify: 'esbuild',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload/index.ts', formats: ['cjs'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
      minify: 'esbuild',
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    // Keep generated Electron bundles and packaging icons outside the renderer
    // watcher.  electron-vite writes these during startup/rebuilds; watching
    // them makes the renderer see self-generated file changes as reloads.
    server: {
      watch: {
        ignored: ['**/out/**', '**/assets/icon.png', '**/assets/icon.icns', '**/assets/icon.iconset/**'],
      },
    },
    build: {
      // electron-vite defaults the renderer to minify: false, which also turns
      // off CSS minification (cssMinify follows minify). Minify like main and
      // preload do: Electron never consumes readable output, and less source
      // is faster for V8 to read, parse, and compile at startup.
      minify: 'esbuild',
      rollupOptions: {
        input: resolve('index.html'),
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/@xterm/')) return 'terminal-vendor'
            if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/unified/')) return 'markdown-vendor'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
            if (id.includes('/lucide-react/')) return 'icons-vendor'
            return undefined
          },
        },
      },
    },
  },
})
