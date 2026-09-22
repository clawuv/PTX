import type { AppSettings } from '../../src/types/api'

export type UiLocale = 'en' | 'zh-CN'
export type LocalePreference = AppSettings['locale']

/**
 * Resolves the native-chrome language (application menu, tray, context menus).
 * Mirrors the renderer's `resolveLocale` so both layers agree on what
 * "system" means; explicit preferences win over the OS locale.
 */
export function resolveUiLocale(preference: LocalePreference, systemLocale: string): UiLocale {
  if (preference !== 'system') return preference
  const normalized = systemLocale.toLowerCase()
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) return 'zh-CN'
  return 'en'
}

export interface UiMenuStrings {
  checkForUpdates: string
  quitTemplate: string
  trayOpen: string
  traySettings: string
  trayQuit: string
  copyImage: string
  closeConfirmTitle: string
  closeWhileRunningTitle: string
  agentRunningOne: string
  agentRunningMany: string
  schedulesNotice: string
  scheduleRunFailedTitle: string
  scheduleRunFailedBody: string
  scheduleBlockedTitle: string
  closeButton: string
  cancelButton: string
}

const STRINGS: Record<UiLocale, UiMenuStrings> = {
  en: {
    checkForUpdates: 'Check for Updates…',
    quitTemplate: 'Quit {name}',
    trayOpen: 'Open Ptx',
    traySettings: 'Settings...',
    trayQuit: 'Quit',
    copyImage: 'Copy Image',
    closeConfirmTitle: 'Close Ptx?',
    closeWhileRunningTitle: 'Close Ptx while an agent is running?',
    agentRunningOne: 'An agent run is still in progress and will be stopped.',
    agentRunningMany: '{count} agent runs are still in progress and will be stopped.',
    schedulesNotice: 'Scheduled automations will not run while Ptx is closed.',
    scheduleRunFailedTitle: 'Scheduled run failed: {title}',
    scheduleRunFailedBody: 'Reason: {error}',
    scheduleBlockedTitle: 'Scheduled task blocked: {title}',
    closeButton: 'Close Ptx',
    cancelButton: 'Cancel',
  },
  'zh-CN': {
    checkForUpdates: '检查更新…',
    quitTemplate: '退出 {name}',
    trayOpen: '打开 Ptx',
    traySettings: '设置...',
    trayQuit: '退出',
    copyImage: '复制图像',
    closeConfirmTitle: '要关闭 Ptx 吗？',
    closeWhileRunningTitle: '有代理任务正在运行，仍要关闭 Ptx 吗？',
    agentRunningOne: '一个代理任务仍在运行，关闭后将被停止。',
    agentRunningMany: '{count} 个代理任务仍在运行，关闭后将被停止。',
    schedulesNotice: '关闭 Ptx 后，定时自动化任务将不会运行。',
    scheduleRunFailedTitle: '定时运行失败：{title}',
    scheduleRunFailedBody: '原因：{error}',
    scheduleBlockedTitle: '定时任务已阻断：{title}',
    closeButton: '关闭 Ptx',
    cancelButton: '取消',
  },
}

export function uiMenuStrings(locale: UiLocale): UiMenuStrings {
  return STRINGS[locale]
}
