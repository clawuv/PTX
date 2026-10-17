import { registerApp } from '@larksuiteoapi/node-sdk'
import QRCode from 'qrcode'
import type { FeishuBindingState } from '../../../src/types/feishu'
import { requireString } from '../validation'

export class FeishuBinding {
  private controller?: AbortController
  private state: FeishuBindingState = { phase: 'idle' }
  private credentials?: { appId: string; secret: string; openId: string }
  private timer?: ReturnType<typeof setTimeout>

  constructor(private register: typeof registerApp = registerApp) {}

  status(): FeishuBindingState { return { ...this.state } }

  cancel(): FeishuBindingState {
    this.controller?.abort()
    this.controller = undefined
    clearTimeout(this.timer)
    this.credentials = undefined
    this.state = { phase: 'idle' }
    return this.status()
  }

  begin(): FeishuBindingState {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    this.state = { phase: 'loading' }
    const fail = (message: string) => {
      if (this.controller !== controller) return
      this.cancel()
      this.state = { phase: 'error', message }
    }
    this.timer = setTimeout(() => fail('二维码已过期，请重新扫码。'), 10 * 60_000)
    this.timer.unref()
    void this.register({
      domain: 'accounts.feishu.cn',
      createOnly: true,
      signal: controller.signal,
      appPreset: { name: 'PTX 手机助手', desc: '从手机飞书向自己的电脑发送开发任务并查看结果' },
      addons: {
        preset: false,
        scopes: { tenant: ['im:message.p2p_msg:readonly', 'im:message:send_as_bot', 'cardkit:card:write'] },
        events: { items: { tenant: ['im.message.receive_v1'] } },
      },
      onQRCodeReady: ({ url, expireIn }) => {
        void (async () => {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' || !['accounts.feishu.cn', 'open.feishu.cn'].includes(parsed.hostname)) throw new Error('Unexpected registration host')
          const image = await QRCode.toDataURL(url, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
          if (this.controller !== controller || this.credentials) return
          const expiresAt = Date.now() + Math.min(Math.max(expireIn, 1), 600) * 1000
          clearTimeout(this.timer)
          this.timer = setTimeout(() => fail('二维码已过期，请重新扫码。'), expiresAt - Date.now())
          this.timer.unref()
          this.state = { phase: 'waiting', image, expiresAt }
        })().catch(() => fail('无法生成飞书二维码，请重试。'))
      },
    }).then((result) => {
      if (this.controller !== controller) return
      const appId = requireString(result.client_id, 'App ID', { min: 5, max: 100 })
      const secret = requireString(result.client_secret, 'App Secret', { min: 1, max: 512 })
      const openId = result.user_info?.open_id ?? ''
      if (!/^cli_[a-zA-Z0-9]+$/.test(appId) || !/^ou_[a-zA-Z0-9_-]+$/.test(openId)) {
        fail('飞书未返回完整的应用或账号信息，请使用手动配置。')
        return
      }
      clearTimeout(this.timer)
      this.credentials = { appId, secret, openId }
      this.state = { phase: 'authorized', appId, openId }
      this.timer = setTimeout(() => fail('绑定信息已过期，请重新扫码。'), 10 * 60_000)
      this.timer.unref()
    }).catch(() => fail('扫码创建未完成。请检查网络、企业创建应用权限，或重新扫码。'))
    return this.status()
  }

  requireCredentials() {
    if (!this.credentials || this.state.phase !== 'authorized') throw new Error('请先完成飞书扫码。')
    return { ...this.credentials }
  }
}
