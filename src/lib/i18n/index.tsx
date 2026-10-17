import { tasksCatalog } from './catalogs/tasks'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { LocalePreference } from '@/types/api'
import { baseCatalog } from './catalogs/base'
import { chatCatalog } from './catalogs/chat'
import { inspectorCatalog } from './catalogs/inspector'
import { miscCatalog } from './catalogs/misc'
import { pagesCatalog } from './catalogs/pages'
import { settingsCatalog } from './catalogs/settings'
import { shellCatalog } from './catalogs/shell'
import { resolveLocale, type Message, type MessageValues, type ResolvedLocale } from './runtime'

export { resolveLocale }
export type { Message, MessageValues, ResolvedLocale }

// `Object.assign` keeps the literal key unions of each catalog slice, so
// `MessageKey` below stays a precise union instead of widening to `string`.
// The chain is split because `Object.assign` only preserves literals for up
// to four source arguments.
const enPartOne = Object.assign({}, baseCatalog.en, shellCatalog.en, chatCatalog.en, settingsCatalog.en)
const englishCatalog = Object.assign(Object.assign(enPartOne, pagesCatalog.en, inspectorCatalog.en, miscCatalog.en), tasksCatalog.en)

export type MessageKey = keyof typeof englishCatalog

const zhPartOne = Object.assign({}, baseCatalog.zh, shellCatalog.zh, chatCatalog.zh, settingsCatalog.zh)
const zhCatalog: Partial<Record<MessageKey, Message>> = Object.assign(Object.assign(zhPartOne, pagesCatalog.zh, inspectorCatalog.zh, miscCatalog.zh), tasksCatalog.zh)

export function translate(locale: ResolvedLocale, key: MessageKey, values: MessageValues = {}): string {
  const translated = locale === 'zh-CN' ? zhCatalog[key] : undefined
  const message = translated ?? englishCatalog[key]
  const template = typeof message === 'string'
    ? message
    : message[new Intl.PluralRules(locale).select(Number(values.count)) === 'one' ? 'one' : 'other']
  return Object.entries(values).reduce((result, [name, value]) => result.split(`{${name}}`).join(String(value)), template)
}

interface I18nContextValue {
  locale: ResolvedLocale
  t(key: MessageKey, values?: MessageValues): string
}

const I18nContext = createContext<I18nContextValue>({ locale: 'en', t: (key, values) => translate('en', key, values) })

export function I18nProvider({ preference, children }: { preference: LocalePreference; children: ReactNode }) {
  const locale = resolveLocale(preference)
  const value = useMemo<I18nContextValue>(() => ({ locale, t: (key, values) => translate(locale, key, values) }), [locale])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
