import { describe, expect, it } from 'vitest'
import { resolveUiLocale, uiMenuStrings } from '../../electron/main/ui-locale'

describe('native chrome locale', () => {
  it('honors an explicit preference over the system locale', () => {
    expect(resolveUiLocale('zh-CN', 'en-US')).toBe('zh-CN')
    expect(resolveUiLocale('en', 'zh-CN')).toBe('en')
  })

  it('detects Simplified Chinese system locales like the renderer does', () => {
    expect(resolveUiLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveUiLocale('system', 'zh-Hans-US')).toBe('zh-CN')
    expect(resolveUiLocale('system', 'zh-SG')).toBe('zh-CN')
    expect(resolveUiLocale('system', 'zh-TW')).toBe('en')
    expect(resolveUiLocale('system', 'en-US')).toBe('en')
    expect(resolveUiLocale('system', 'de-DE')).toBe('en')
  })

  it('provides native chrome strings for both locales', () => {
    expect(uiMenuStrings('en')).toMatchObject({ copyImage: 'Copy Image', trayQuit: 'Quit' })
    expect(uiMenuStrings('zh-CN')).toMatchObject({ copyImage: '复制图像', trayQuit: '退出' })
    expect(uiMenuStrings('zh-CN').quitTemplate).toContain('{name}')
  })
})
