import type { HarnessId } from './api'

export interface FeishuConfig {
  appId: string
  allowedOpenId: string
  harness: HarnessId
  projectId: string
  model: string
}
export interface FeishuStatus {
  config: FeishuConfig | null
  hasSecret: boolean
  enabled: boolean
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  error?: string
}
export interface FeishuApi {
  beginBinding(): Promise<FeishuBindingState>
  bindingStatus(): Promise<FeishuBindingState>
  cancelBinding(): Promise<FeishuBindingState>
  finishBinding(config: Pick<FeishuConfig, 'harness' | 'projectId' | 'model'>): Promise<FeishuStatus>
  status(): Promise<FeishuStatus>
  save(config: FeishuConfig, appSecret: string): Promise<FeishuStatus>
  connect(): Promise<FeishuStatus>
  disconnect(): Promise<FeishuStatus>
  forget(): Promise<FeishuStatus>
}

export type FeishuBindingState =
  | { phase: 'idle' | 'loading' }
  | { phase: 'waiting'; image: string; expiresAt: number }
  | { phase: 'authorized'; appId: string; openId: string }
  | { phase: 'error'; message: string }
