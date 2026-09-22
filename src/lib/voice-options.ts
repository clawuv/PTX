import type { MessageKey, MessageValues } from '@/lib/i18n'
import type { VoiceTranscriptionProvider } from '@/types/api'

/**
 * Voice picker entries. `label`/`detail` hold i18n message keys; the render
 * site translates them with `t(option.label, option.labelValues)`.
 */
export interface VoiceOption {
  value: string
  label: MessageKey
  labelValues?: MessageValues
  detail: MessageKey
  recommended?: boolean
}

export interface VoiceProviderOption extends VoiceOption {
  value: VoiceTranscriptionProvider
  credential?: 'openai' | 'groq' | 'deepgram'
}

export const VOICE_PROVIDER_OPTIONS: VoiceProviderOption[] = [
  { value: 'openai-live', label: 'voice.provider.openaiLive.label', detail: 'voice.provider.openaiLive.detail', credential: 'openai', recommended: true },
  { value: 'openai', label: 'voice.provider.openaiRecorded.label', detail: 'voice.provider.openaiRecorded.detail', credential: 'openai' },
  { value: 'groq', label: 'voice.provider.groq.label', detail: 'voice.provider.groq.detail', credential: 'groq' },
  { value: 'deepgram', label: 'voice.provider.deepgram.label', detail: 'voice.provider.deepgram.detail', credential: 'deepgram' },
  { value: 'self-hosted', label: 'voice.provider.selfHosted.label', detail: 'voice.provider.selfHosted.detail' },
  { value: 'local-whisper', label: 'voice.provider.localWhisper.label', detail: 'voice.provider.localWhisper.detail' },
]

export const OPENAI_LIVE_MODELS: VoiceOption[] = [
  { value: 'gpt-live-transcribe', label: 'voice.model.liveTranscribe.label', detail: 'voice.model.liveTranscribe.detail', recommended: true },
  { value: 'gpt-realtime-whisper', label: 'voice.model.realtimeWhisper.label', detail: 'voice.model.realtimeWhisper.detail' },
]

export const OPENAI_FILE_MODELS: VoiceOption[] = [
  { value: 'gpt-transcribe', label: 'voice.model.gptTranscribe.label', detail: 'voice.model.gptTranscribe.detail', recommended: true },
  { value: 'gpt-4o-transcribe', label: 'voice.model.gpt4oTranscribe.label', detail: 'voice.model.gpt4oTranscribe.detail' },
  { value: 'gpt-4o-mini-transcribe', label: 'voice.model.gpt4oMiniTranscribe.label', detail: 'voice.model.gpt4oMiniTranscribe.detail' },
  { value: 'whisper-1', label: 'voice.model.whisper1.label', detail: 'voice.model.whisper1.detail' },
]

export const GROQ_MODELS: VoiceOption[] = [
  { value: 'whisper-large-v3-turbo', label: 'voice.model.whisperLargeV3Turbo.label', detail: 'voice.model.whisperLargeV3Turbo.detail', recommended: true },
  { value: 'whisper-large-v3', label: 'voice.model.whisperLargeV3.label', detail: 'voice.model.whisperLargeV3.detail' },
]

export const DEEPGRAM_MODELS: VoiceOption[] = [
  { value: 'nova-3', label: 'voice.model.nova3General.label', detail: 'voice.model.nova3General.detail', recommended: true },
  { value: 'nova-3-medical', label: 'voice.model.nova3Medical.label', detail: 'voice.model.nova3Medical.detail' },
  { value: 'nova-2-meeting', label: 'voice.model.nova2Meeting.label', detail: 'voice.model.nova2Meeting.detail' },
  { value: 'nova-2-phonecall', label: 'voice.model.nova2Phonecall.label', detail: 'voice.model.nova2Phonecall.detail' },
  { value: 'nova-2-conversationalai', label: 'voice.model.nova2Conversationalai.label', detail: 'voice.model.nova2Conversationalai.detail' },
]

export const REALTIME_MODELS: VoiceOption[] = [
  { value: 'gpt-realtime-2.1', label: 'voice.model.realtime21.label', detail: 'voice.model.realtime21.detail', recommended: true },
  { value: 'gpt-realtime-2.1-mini', label: 'voice.model.realtime21Mini.label', detail: 'voice.model.realtime21Mini.detail' },
]

export const REALTIME_VOICES: VoiceOption[] = [
  { value: 'marin', label: 'voice.voice.marin.label', detail: 'voice.voice.marin.detail', recommended: true },
  { value: 'cedar', label: 'voice.voice.cedar.label', detail: 'voice.voice.cedar.detail', recommended: true },
  { value: 'alloy', label: 'voice.voice.alloy.label', detail: 'voice.voice.alloy.detail' },
  { value: 'ash', label: 'voice.voice.ash.label', detail: 'voice.voice.ash.detail' },
  { value: 'ballad', label: 'voice.voice.ballad.label', detail: 'voice.voice.ballad.detail' },
  { value: 'coral', label: 'voice.voice.coral.label', detail: 'voice.voice.coral.detail' },
  { value: 'echo', label: 'voice.voice.echo.label', detail: 'voice.voice.echo.detail' },
  { value: 'sage', label: 'voice.voice.sage.label', detail: 'voice.voice.sage.detail' },
  { value: 'shimmer', label: 'voice.voice.shimmer.label', detail: 'voice.voice.shimmer.detail' },
  { value: 'verse', label: 'voice.voice.verse.label', detail: 'voice.voice.verse.detail' },
]

export function optionsWithCurrent(options: VoiceOption[], current: string): VoiceOption[] {
  return options.some((option) => option.value === current)
    ? options
    : [{ value: current, label: 'voice.option.previousSetting', labelValues: { name: current }, detail: 'voice.option.keptFromEarlier' }, ...options]
}
