import { useEffect, useState, type ReactNode } from 'react'
import type { FeishuBindingState, FeishuConfig, FeishuStatus } from '@/types/feishu'
import { Modal } from '@/components/ui'
import { errorMessage } from '@/lib/errors'

export function FeishuBindingDialog({ target, targetFields, onBound, onClose }: {
  target: Pick<FeishuConfig, 'harness' | 'projectId' | 'model'>
  targetFields: ReactNode
  onBound(status: FeishuStatus): void
  onClose(): void
}) {
  const [state, setState] = useState<FeishuBindingState>({ phase: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let polling = false
    void Promise.resolve().then(async () => {
      if (!live) return
      setState({ phase: 'loading' })
      try { const next = await window.ptx.feishu.beginBinding(); if (live) setState(next) }
      catch (error) { if (live) setError(errorMessage(error)) }
    })
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void window.ptx.feishu.bindingStatus().then((state) => { if (live) setState(state) })
        .catch((error: unknown) => { if (live) setError(errorMessage(error)) }).finally(() => { polling = false })
    }, 1000)
    return () => { live = false; clearInterval(timer); void window.ptx.feishu.cancelBinding().catch(() => undefined) }
  }, [])
  const begin = async () => {
    setError(''); setBusy(true)
    try { setState(await window.ptx.feishu.beginBinding()) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const finish = async () => {
    setBusy(true); setError('')
    try { onBound(await window.ptx.feishu.finishBinding(target)); onClose() }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <Modal title="扫码绑定飞书" onClose={() => { if (!busy) onClose() }} footer={<>
    <button type="button" className="button" disabled={busy} onClick={onClose}>取消</button>
    {state.phase === 'authorized'
      ? <button type="button" className="button button--primary" disabled={busy || !target.projectId || !target.model} onClick={() => void finish()}>保存绑定</button>
      : state.phase === 'idle' || state.phase === 'error'
        ? <button type="button" className="button button--primary" disabled={busy} onClick={() => void begin()}>{state.phase === 'error' ? '重新生成二维码' : '生成二维码'}</button> : null}
  </>}>
    <div className="feishu-binding">
      {state.phase === 'waiting' ? <><img src={state.image} width={176} height={176} alt="飞书创建应用授权二维码" /><p>使用手机飞书扫一扫，确认创建新应用及权限。</p><small>有效期至 {new Date(state.expiresAt).toLocaleTimeString()}</small></> : null}
      {state.phase === 'loading' ? <p role="status">正在获取飞书二维码…</p> : null}
      {state.phase === 'idle' ? <p>扫码后将在你的企业内创建一个 PTX 机器人，应用密钥会自动加密保存，无需复制。</p> : null}
      {state.phase === 'authorized' ? <><p role="status">扫码授权成功。请选择允许执行的项目、引擎和模型。</p><p>应用：{state.appId}</p>{targetFields}<p>保存后请连接机器人并发送 /帮助 验证消息接收。扫码成功不代表企业权限、事件订阅及发布状态已验证。</p></> : null}
      {state.phase === 'error' ? <p role="alert">{state.message}</p> : null}
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
    </div>
  </Modal>
}
