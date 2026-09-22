import { translate, type MessageKey, type MessageValues, type ResolvedLocale } from '@/lib/i18n'
import type { PrimeWorkApi } from '@/types/api'
import { errorMessage } from './errors'

type ShellApi = Pick<PrimeWorkApi['app'], 'openExternal' | 'revealPath'>

/**
 * The I18nProvider mirrors the resolved locale onto `<html lang>`, so this
 * non-React module can localize its user-facing failures without context.
 * Outside a DOM (tests, SSR-ish callers) it falls back to English.
 */
function shellLocale(): ResolvedLocale {
  return typeof document !== 'undefined' && document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
}

function shellMessage(key: MessageKey, values?: MessageValues): string {
  return translate(shellLocale(), key, values)
}

/**
 * The main process answers these shell requests with a boolean instead of a
 * rejection so a denied path or URL cannot crash a caller. A dropped `false`
 * would leave the click looking like a no-op, so every caller turns the result
 * into display text: null means the request reached the operating system.
 */
export async function openExternalUrl(app: ShellApi, url: string): Promise<string | null> {
  try {
    return await app.openExternal(url) ? null : shellMessage('app.error.openExternal', { url })
  } catch (error) {
    return errorMessage(error)
  }
}

export async function revealPath(app: ShellApi, path: string): Promise<string | null> {
  try {
    return await app.revealPath(path) ? null : shellMessage('app.error.revealPath', { path })
  } catch (error) {
    return errorMessage(error)
  }
}
