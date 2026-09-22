import type { LocalePreference } from '@/types/api'

export type Message = string | { one: string; other: string }
export type MessageValues = Record<string, string | number>
export type ResolvedLocale = 'en' | 'zh-CN'

export interface Catalog<K extends string = string> {
  en: Record<K, Message>
  zh: Partial<Record<K, Message>>
}

/**
 * Declares a bilingual catalog slice. The English entries are the source of
 * truth for message keys; Chinese entries must use a subset of those keys.
 */
export function defineCatalog<K extends string>(en: { readonly [P in K]: Message }, zh: { readonly [P in K]?: Message }): Catalog<K> {
  return { en, zh }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages.length ? navigator.languages : [navigator.language]
}

export function resolveLocale(preference: LocalePreference, languages: readonly string[] = browserLanguages()): ResolvedLocale {
  if (preference !== 'system') return preference
  for (const language of languages) {
    const normalized = language.toLowerCase()
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
    if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) return 'zh-CN'
  }
  return 'en'
}
