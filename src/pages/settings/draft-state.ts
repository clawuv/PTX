import type { MessageKey } from '@/lib/i18n'

export interface DraftCommit {
  id: number
  value: string
  baseline: string
  revision: number
  sawDifferentSource: boolean
}

export interface DraftSettlement {
  value: string
  baseline: string
}

export interface DraftState {
  value: string
  source: string
  baseline: string
  dirty: boolean
  revision: number
  pending: DraftCommit | null
  settlement: DraftSettlement | null
  error: string
}

export type DraftAction =
  | { type: 'sync'; value: string }
  | { type: 'edit'; value: string; error: string }
  | { type: 'commit'; id: number; value: string }
  | { type: 'resolve'; id: number }
  | { type: 'reject'; id: number; error: string }

export function createDraftState(value: string): DraftState {
  return { value, source: value, baseline: value, dirty: false, revision: 0, pending: null, settlement: null, error: '' }
}

export function reduceDraftState(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'sync': {
      if (state.pending) {
        return {
          ...state,
          source: action.value,
          pending: {
            ...state.pending,
            sawDifferentSource: state.pending.sawDifferentSource || action.value !== state.pending.baseline,
          },
        }
      }
      if (state.settlement && action.value === state.settlement.baseline && state.settlement.value !== state.settlement.baseline) {
        return {
          ...state,
          source: action.value,
          baseline: action.value,
          dirty: state.value !== action.value,
          settlement: null,
          error: 'The setting could not be saved.',
        }
      }
      if (!state.dirty) return { ...state, value: action.value, source: action.value, baseline: action.value, settlement: null }
      if (action.value === state.value) {
        return { ...state, source: action.value, baseline: action.value, dirty: false, settlement: null }
      }
      return { ...state, source: action.value, baseline: action.value, dirty: true, settlement: null }
    }
    case 'edit': {
      const revision = state.revision + 1
      return {
        ...state,
        value: action.value,
        dirty: action.value !== state.baseline,
        revision,
        error: action.error,
      }
    }
    case 'commit':
      return {
        ...state,
        pending: { id: action.id, value: action.value, baseline: state.baseline, revision: state.revision, sawDifferentSource: false },
        settlement: null,
        error: '',
      }
    case 'resolve': {
      if (state.pending?.id !== action.id) return state
      const submitted = state.pending
      const rolledBack = submitted.sawDifferentSource && state.source === submitted.baseline && submitted.value !== submitted.baseline
      if (rolledBack) {
        return {
          ...state,
          baseline: submitted.baseline,
          dirty: state.value !== submitted.baseline,
          pending: null,
          settlement: null,
          error: state.revision === submitted.revision ? 'The setting could not be saved.' : '',
        }
      }
      const committed = state.source !== submitted.baseline ? state.source : submitted.value
      const settlement = { value: committed, baseline: submitted.baseline }
      if (state.revision === submitted.revision) {
        return {
          ...state,
          value: committed,
          baseline: committed,
          dirty: false,
          pending: null,
          settlement,
          error: '',
        }
      }
      return {
        ...state,
        baseline: committed,
        dirty: state.value !== committed,
        pending: null,
        settlement,
        error: '',
      }
    }
    case 'reject': {
      if (state.pending?.id !== action.id) return state
      const isCurrentDraft = state.revision === state.pending.revision
      return {
        ...state,
        baseline: state.pending.baseline,
        dirty: state.value !== state.pending.baseline,
        pending: null,
        settlement: null,
        error: isCurrentDraft ? action.error : '',
      }
    }
  }
}

export function browserHomeValidation(value: string): string {
  if (value.trim().length === 0) return 'Enter a home page URL.'
  if (value.trim().length > 8192) return 'The home page URL is too long.'
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return 'Enter a complete http:// or https:// URL.'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Use an http:// or https:// URL.'
  if (parsed.username || parsed.password) return 'URLs containing credentials are not allowed.'
  return ''
}

export function normalizeBrowserHome(value: string): string {
  return new URL(value.trim()).toString()
}

export function terminalShellValidation(value: string): string {
  if (value.length === 0) return 'Enter a shell executable path.'
  if (value.includes('\0')) return 'The shell path cannot contain a NUL character.'
  if (value.length > 4096) return 'The shell path is too long.'
  if (!value.startsWith('/')) return 'Enter an absolute shell path beginning with /.'
  return ''
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The setting could not be saved.'
}

/**
 * Local validation and reducer errors are pure English strings so callers and
 * tests can match them directly; this map lets the renderer translate the known
 * messages at render time while dynamic main-process errors pass through.
 */
const DRAFT_ERROR_KEYS: Record<string, MessageKey> = {
  'The setting could not be saved.': 'settings.error.notSaved',
  'Enter a home page URL.': 'settings.browser.home.error.empty',
  'The home page URL is too long.': 'settings.browser.home.error.tooLong',
  'Enter a complete http:// or https:// URL.': 'settings.browser.home.error.incomplete',
  'Use an http:// or https:// URL.': 'settings.browser.home.error.protocol',
  'URLs containing credentials are not allowed.': 'settings.browser.home.error.credentials',
  'Enter a shell executable path.': 'settings.terminal.shell.error.empty',
  'The shell path cannot contain a NUL character.': 'settings.terminal.shell.error.nul',
  'The shell path is too long.': 'settings.terminal.shell.error.tooLong',
  'Enter an absolute shell path beginning with /.': 'settings.terminal.shell.error.absolute',
}

/** Translates a known draft error for display; unknown or dynamic errors render unchanged. */
export function draftErrorMessage(error: string, t: (key: MessageKey) => string): string {
  const key = DRAFT_ERROR_KEYS[error]
  return key ? t(key) : error
}
