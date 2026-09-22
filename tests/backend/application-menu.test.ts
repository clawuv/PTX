import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { name: 'PiStudio' },
  Menu: electron,
}))

import { buildApplicationMenuTemplate, installApplicationMenu } from '../../electron/main/application-menu'

function submenu(item: ReturnType<typeof buildApplicationMenuTemplate>[number] | undefined) {
  return item && Array.isArray(item.submenu) ? item.submenu : []
}

beforeEach(() => {
  electron.buildFromTemplate.mockClear()
  electron.setApplicationMenu.mockClear()
})

describe('application update menu', () => {
  it('puts Check for Updates in the app menu on macOS', () => {
    const checkForUpdates = vi.fn()
    const template = buildApplicationMenuTemplate({ platform: 'darwin', appName: 'PiStudio', checkForUpdates, closeWindow: vi.fn() })
    const appMenu = template[0]
    const updateItem = submenu(appMenu).find((item) => item.label === 'Check for Updates…')

    expect(appMenu?.label).toBe('PiStudio')
    expect(updateItem).toBeDefined()
    updateItem?.click?.(undefined as never, undefined as never, undefined as never)
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })

  it('puts Check for Updates in Help on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const checkForUpdates = vi.fn()
      const template = buildApplicationMenuTemplate({ platform, appName: 'PiStudio', checkForUpdates, closeWindow: vi.fn() })
      const helpMenu = template.at(-1)
      expect(helpMenu?.role).toBe('help')
      const updateItem = submenu(helpMenu).find((item) => item.label === 'Check for Updates…')
      expect(updateItem).toBeDefined()
      updateItem?.click?.(undefined as never, undefined as never, undefined as never)
      expect(checkForUpdates).toHaveBeenCalledOnce()
    }
  })

  it('disables Check for Updates when the build has no update service', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const template = buildApplicationMenuTemplate({ platform, appName: 'PiStudio', updatesEnabled: false, checkForUpdates: vi.fn(), closeWindow: vi.fn() })
      const owner = platform === 'darwin' ? template[0] : template.at(-1)
      const updateItem = submenu(owner).find((item) => item.label === 'Check for Updates…')
      expect(updateItem?.enabled).toBe(false)
    }
    const enabled = buildApplicationMenuTemplate({ platform: 'linux', appName: 'PiStudio', checkForUpdates: vi.fn(), closeWindow: vi.fn() })
    expect(submenu(enabled.at(-1)).find((item) => item.label === 'Check for Updates…')?.enabled).toBe(true)
  })

  it('installs the native application menu', () => {
    const checkForUpdates = vi.fn()
    installApplicationMenu({ platform: 'linux', appName: 'PiStudio', checkForUpdates, closeWindow: vi.fn() })
    expect(electron.buildFromTemplate).toHaveBeenCalledOnce()
    expect(electron.setApplicationMenu).toHaveBeenCalledWith(electron.buildFromTemplate.mock.results[0]?.value)
  })

  it('routes macOS Command-Q through the main-window close path', () => {
    const closeWindow = vi.fn()
    const template = buildApplicationMenuTemplate({ platform: 'darwin', appName: 'PiStudio', checkForUpdates: vi.fn(), closeWindow })
    const quitItem = submenu(template[0]).find((item) => item.label === 'Quit PiStudio')

    expect(quitItem?.role).toBeUndefined()
    expect(quitItem?.accelerator).toBe('CommandOrControl+Q')
    quitItem?.click?.(undefined as never, undefined as never, undefined as never)
    expect(closeWindow).toHaveBeenCalledOnce()
  })

  it('localizes custom items when the preference is Simplified Chinese', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const template = buildApplicationMenuTemplate({ platform, appName: 'PiStudio', locale: 'zh-CN', systemLocale: 'en-US', checkForUpdates: vi.fn(), closeWindow: vi.fn() })
      const owner = platform === 'darwin' ? template[0] : template.at(-1)
      expect(submenu(owner).find((item) => item.label === '检查更新…')).toBeDefined()
    }
    const template = buildApplicationMenuTemplate({ platform: 'darwin', appName: 'PiStudio', locale: 'zh-CN', systemLocale: 'en-US', checkForUpdates: vi.fn(), closeWindow: vi.fn() })
    expect(submenu(template[0]).find((item) => item.label === '退出 PiStudio')).toBeDefined()
  })

  it('resolves the system preference against the OS locale', () => {
    const chinese = buildApplicationMenuTemplate({ platform: 'win32', appName: 'PiStudio', locale: 'system', systemLocale: 'zh-CN', checkForUpdates: vi.fn(), closeWindow: vi.fn() })
    expect(submenu(chinese.at(-1)).find((item) => item.label === '检查更新…')).toBeDefined()

    const english = buildApplicationMenuTemplate({ platform: 'win32', appName: 'PiStudio', locale: 'system', systemLocale: 'de-DE', checkForUpdates: vi.fn(), closeWindow: vi.fn() })
    expect(submenu(english.at(-1)).find((item) => item.label === 'Check for Updates…')).toBeDefined()
  })
})
