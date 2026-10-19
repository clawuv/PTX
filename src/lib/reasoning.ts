import type { MessageKey } from '@/lib/i18n'
import type { AgentThinkingLevel } from '@/types/api'

/**
 * Shared display names for the harness reasoning vocabulary. The composer's
 * model picker and the per-model default selector in Settings → Providers must
 * name the same level identically, so the mapping lives here rather than in
 * either component.
 */
export const REASONING_LABEL_KEYS: Record<AgentThinkingLevel, MessageKey> = {
  off: 'composer.reasoning.off',
  minimal: 'composer.reasoning.minimal',
  low: 'composer.reasoning.low',
  medium: 'composer.reasoning.medium',
  high: 'composer.reasoning.high',
  xhigh: 'composer.reasoning.xhigh',
  max: 'composer.reasoning.max',
}
