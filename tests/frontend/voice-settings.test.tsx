// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/lib/data'
import { VoiceSettings } from '../../src/pages/settings/VoiceSettings'
import type { AppSettings, PtxApi, VoiceCredentialStatus } from '../../src/types/api'

vi.mock('../../src/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/ui')>()),
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => <div role="dialog" aria-label={title}>{children}{footer}</div>,
}))

const emptyStatus: VoiceCredentialStatus = {
  configured: { openai: false, groq: false, deepgram: false, 'self-hosted': false },
  source: {},
  storage: { available: true },
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(node: ReactNode) {
  await act(async () => { root.render(node); await Promise.resolve() })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openOptions(label: string) {
  const trigger = [...container.querySelectorAll<HTMLButtonElement>('[role="combobox"]')].find((button) => button.getAttribute('aria-label') === label)!
  await act(async () => { trigger.click() })
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')]
}

async function choose(label: string, value: string) {
  const options = await openOptions(label)
  await act(async () => { options.find((option) => option.getAttribute('data-value') === value)!.click() })
}

function voiceBridge(overrides: Partial<PtxApi['voice']> = {}): PtxApi['voice'] {
  return {
    credentialStatus: vi.fn().mockResolvedValue(emptyStatus),
    saveApiKey: vi.fn().mockResolvedValue(emptyStatus),
    deleteApiKey: vi.fn().mockResolvedValue(emptyStatus),
    createRealtimeCall: vi.fn(),
    transcribe: vi.fn(),
    testSelfHosted: vi.fn().mockResolvedValue(true),
    executeTool: vi.fn(),
    ...overrides,
  }
}

function Harness({ voice }: { voice: PtxApi['voice'] | null }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  return <VoiceSettings settings={settings} voice={voice} onUpdate={(patch) => { setSettings((current) => ({ ...current, ...patch })) }} />
}

describe('Voice settings setup flow', () => {
  it('shows only the selected provider model picker and switches to curated Groq models', async () => {
    await render(<Harness voice={voiceBridge()} />)

    const service = container.querySelector<HTMLButtonElement>('button[aria-label="Dictation service"]')!
    expect(service.getAttribute('data-value')).toBe('openai-live')
    let modelOptions = await openOptions('Dictation model')
    expect(modelOptions.map((option) => option.getAttribute('data-value'))).toEqual(['gpt-live-transcribe', 'gpt-realtime-whisper'])
    await act(async () => { modelOptions.find((option) => option.getAttribute('aria-selected') === 'true')!.click() })
    expect(container.querySelector('input[aria-label="whisper-cli executable"]')).toBeNull()

    await choose('Dictation service', 'groq')
    modelOptions = await openOptions('Dictation model')
    expect(modelOptions.map((option) => option.getAttribute('data-value'))).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3'])
    expect(container.textContent).not.toContain('OpenAI file model')
  })

  it('opens an enabled API-key flow and saves through the voice bridge', async () => {
    const saveApiKey = vi.fn().mockResolvedValue({
      configured: { openai: true, groq: false, deepgram: false, 'self-hosted': false },
      source: { openai: 'saved' },
      storage: { available: true },
    } satisfies VoiceCredentialStatus)
    await render(<Harness voice={voiceBridge({ saveApiKey })} />)

    const openAiCard = [...container.querySelectorAll<HTMLElement>('.voice-connection-card')].find((card) => card.textContent?.includes('OpenAI'))!
    const addKey = [...openAiCard.querySelectorAll('button')].find((button) => button.textContent?.includes('Add key'))!
    expect(addKey.disabled).toBe(false)
    await click(addKey)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const input = dialog.querySelector<HTMLInputElement>('input[type="password"]')!
    await enter(input, 'sk-test-key')
    const save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Save API key'))!
    await click(save)

    expect(saveApiKey).toHaveBeenCalledWith('openai', 'sk-test-key')
  })

  it('explains secure keychain retrieval in the realtime section', async () => {
    await render(<Harness voice={voiceBridge()} />)

    const realtime = container.querySelector<HTMLElement>('[aria-labelledby="voice-realtime-title"]')!
    expect(realtime.textContent).toContain('Saved API keys are encrypted using your operating system’s internal keychain.')
    expect(realtime.textContent).toContain('may ask for your password to retrieve the key')
  })

  it('allows a session key and warns that it will not persist without secure Linux storage', async () => {
    const message = 'Ptx will not save voice API keys because this Linux desktop is using unprotected basic-text storage. Install and unlock GNOME Keyring (libsecret) or KWallet, then restart Ptx.'
    const saveApiKey = vi.fn().mockResolvedValue({
      configured: { openai: true, groq: false, deepgram: false, 'self-hosted': false },
      source: { openai: 'session' },
      storage: { available: false, message },
    } satisfies VoiceCredentialStatus)
    await render(<Harness voice={voiceBridge({
      credentialStatus: vi.fn().mockResolvedValue({
        configured: { openai: false, groq: false, deepgram: false, 'self-hosted': false },
        source: { openai: 'saved' },
        storage: { available: false, message },
      } satisfies VoiceCredentialStatus),
      saveApiKey,
    })} />)

    expect(container.textContent).toContain('Keys will work only until Ptx quits')
    expect(container.textContent).toContain('GNOME Keyring (libsecret) or KWallet')
    expect(container.textContent).toContain('will not save it to disk')
    expect(container.textContent).toContain('Storage locked')
    const openAiCard = [...container.querySelectorAll<HTMLElement>('.voice-connection-card')].find((card) => card.textContent?.includes('OpenAI'))!
    const addKey = [...openAiCard.querySelectorAll('button')].find((button) => button.textContent?.includes('Add key'))!
    expect(addKey.disabled).toBe(false)
    await click(addKey)

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('only in desktop memory')
    expect(dialog.textContent).toContain('will not write the key to disk')
    const input = dialog.querySelector<HTMLInputElement>('input[type="password"]')!
    await enter(input, 'sk-session-key')
    const save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Save API key'))!
    await click(save)

    expect(saveApiKey).toHaveBeenCalledWith('openai', 'sk-session-key')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(openAiCard.textContent).toContain('Session only')
    expect(container.textContent).toContain('Keys will work only until Ptx quits')
  })

  it('explains how to recover an older desktop process instead of showing disabled key buttons', async () => {
    await render(<Harness voice={null} />)

    expect(container.textContent).toContain('Restart Ptx to finish enabling Voice')
    expect(container.textContent).toContain('⌘Q')
    expect([...container.querySelectorAll('button')].some((button) => button.disabled && button.textContent?.includes('Add key'))).toBe(false)
  })

  it('connects and tests a self-hosted Parakeet or Whisper endpoint with an optional token', async () => {
    const testSelfHosted = vi.fn().mockResolvedValue(true)
    const saveApiKey = vi.fn().mockResolvedValue({
      configured: { openai: false, groq: false, deepgram: false, 'self-hosted': true },
      source: { 'self-hosted': 'saved' },
      storage: { available: true },
    } satisfies VoiceCredentialStatus)
    await render(<Harness voice={voiceBridge({ testSelfHosted, saveApiKey })} />)

    await choose('Dictation service', 'self-hosted')
    expect(container.textContent).toContain('Connect your transcription server')
    expect(container.textContent).toContain('Parakeet, Whisper')
    expect(container.querySelector('input[aria-label="whisper-cli executable"]')).toBeNull()
    expect(container.textContent).not.toContain('API key required')

    const url = container.querySelector<HTMLInputElement>('input[aria-label="Self-hosted server URL"]')!
    const model = container.querySelector<HTMLInputElement>('input[aria-label="Self-hosted model ID"]')!
    await enter(url, 'http://127.0.0.1:9000')
    await enter(model, 'nvidia/parakeet-tdt-0.6b-v3')

    const addToken = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add token'))!
    await click(addToken)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('optional bearer token')
    await enter(dialog.querySelector<HTMLInputElement>('input[type="password"]')!, 'local-token')
    await click([...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Save token'))!)
    expect(saveApiKey).toHaveBeenCalledWith('self-hosted', 'local-token')

    await click([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Connect & test'))!)
    expect(testSelfHosted).toHaveBeenCalledWith({ url: 'http://127.0.0.1:9000', model: 'nvidia/parakeet-tdt-0.6b-v3' })
    expect(container.textContent).toContain('Connected. Ptx successfully transcribed a test audio clip.')
  })

  it('turns a missing Voice IPC handler into a restart state instead of checking forever', async () => {
    const credentialStatus = vi.fn().mockRejectedValue(new Error("No handler registered for 'voice:credential-status'"))
    await render(<Harness voice={voiceBridge({ credentialStatus })} />)

    expect(container.textContent).toContain('Restart Ptx to finish enabling Voice')
    expect(container.textContent).toContain('Restart required')
    expect(container.textContent).not.toContain('Checking…')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Add key'))).toBe(false)
  })
})
