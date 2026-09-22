import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { resolveUiLocale, uiMenuStrings, type LocalePreference } from './ui-locale'

interface ApplicationMenuOptions {
  checkForUpdates(): void
  closeWindow(): void
  /** Manual checks are only possible in builds where the update service runs. */
  updatesEnabled?: boolean
  platform?: NodeJS.Platform
  appName?: string
  /** Settings preference; "system" resolves against the OS locale. Defaults to English in tests. */
  locale?: LocalePreference
  /** Overrides the OS locale reported to {@link resolveUiLocale} (used by tests). */
  systemLocale?: string
}

function updateMenuItem(label: string, checkForUpdates: () => void, enabled: boolean): MenuItemConstructorOptions {
  return {
    label,
    enabled,
    click: () => checkForUpdates(),
  }
}

export function buildApplicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const platform = options.platform ?? process.platform
  const appName = options.appName ?? app.name
  const updatesEnabled = options.updatesEnabled ?? true
  const strings = uiMenuStrings(options.locale ? resolveUiLocale(options.locale, options.systemLocale ?? app.getLocale()) : 'en')
  const standardMenus: MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]

  if (platform === 'darwin') {
    return [{
      label: appName,
      submenu: [
        { role: 'about' },
        updateMenuItem(strings.checkForUpdates, options.checkForUpdates, updatesEnabled),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: strings.quitTemplate.replace('{name}', appName), accelerator: 'CommandOrControl+Q', click: () => options.closeWindow() },
      ],
    }, ...standardMenus]
  }

  return [...standardMenus, {
    role: 'help',
    submenu: [updateMenuItem(strings.checkForUpdates, options.checkForUpdates, updatesEnabled)],
  }]
}

export function installApplicationMenu(options: ApplicationMenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(options)))
}
