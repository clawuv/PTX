import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import type { AgentModelDescriptor, ProjectRecord } from '@/types/api'
import type { FeishuConfig, FeishuStatus } from '@/types/feishu'
import { FeishuBindingDialog } from './FeishuBindingDialog'

const EMPTY: FeishuConfig = { appId: '', allowedOpenId: '', harness: 'pi', projectId: '', model: '' }

export function FeishuSettings() {
  const [binding, setBinding] = useState(false)
  const [status, setStatus] = useState<FeishuStatus | null>(null)
  const [config, setConfig] = useState<FeishuConfig>(EMPTY)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [models, setModels] = useState<AgentModelDescriptor[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    const refresh = async (initial = false) => {
      try {
        const value = await window.ptx.feishu.status()
        if (!live) return
        setStatus(value)
        if (initial) {
          setConfig(value.config ?? EMPTY)
          setLoaded(true)
          if (!value.hasSecret) setBinding(true)
        }
      } catch (error) {
        if (live) setError(errorMessage(error))
      }
    }
    void refresh(true)
    const timer = setInterval(() => {
      void refresh()
    }, 3_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let live = true
    setProjects([])
    setModels([])
    void window.ptx.providers
      .catalog(false, config.harness)
      .then((catalog) => {
        if (live) setModels(catalog.models.filter((model) => model.available && model.enabled !== false && catalog.providers.some((provider) => provider.id === model.provider && provider.enabled)))
      })
      .catch((error: unknown) => {
        if (live) setError(errorMessage(error))
      })
    void window.ptx.projects
      .list(config.harness)
      .then((items) => {
        if (live) setProjects(items.filter((item) => !item.inferred && !item.readOnly))
      })
      .catch((error: unknown) => {
        if (live) setError(errorMessage(error))
      })
    return () => {
      live = false
    }
  }, [config.harness])

  const run = async (action: () => Promise<FeishuStatus>) => {
    setBusy(true)
    setError('')
    try {
      const value = await action()
      setStatus(value)
      setConfig(value.config ?? EMPTY)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const dirty = JSON.stringify(config) !== JSON.stringify(status?.config ?? EMPTY)
  return (
    <section className="feishu-settings">
      <header>
        <div>
          <h1>手机 · 飞书</h1>
          <p className="settings-note">使用企业自建应用机器人，手机发任务，电脑本地执行。电脑需保持联网并运行 PTX。</p>
        </div>
        <button type="button" className="button button--primary" disabled={!loaded || busy} onClick={() => setBinding(true)}>
          <Plus size={14} />
          扫描绑定
        </button>
      </header>
      <div className="settings-group">
        <fieldset disabled={busy || !loaded} className="feishu-fields">
          <label className="field">
            <span>执行引擎</span>
            <select
              value={config.harness}
              onChange={(event) => {
                if (event.target.value === 'pi' || event.target.value === 'omp') setConfig({ ...config, harness: event.target.value, projectId: '', model: '' })
              }}
            >
              <option value="pi">Pi</option>
              <option value="omp">OMP</option>
            </select>
          </label>
          <label className="field">
            <span>允许执行的项目</span>
            <select value={config.projectId} onChange={(event) => setConfig({ ...config, projectId: event.target.value })}>
              <option value="">选择已添加的项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>执行模型</span>
            <select value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })}>
              <option value="">选择可用模型</option>
              {config.model && !models.some((model) => model.key === config.model) ? (
                <option value={config.model} disabled>
                  {config.model}（不可用）
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.name} · {model.provider}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <p className="settings-note">连接后，指定账号可让 AI 修改此项目。任务状态和助手回复会发送到飞书，可能包含项目内容。群聊及其他账号不会执行任务。</p>
        <div className="feishu-actions">
          <button
            type="button"
            className="button"
            disabled={busy || !loaded || !dirty || !config.projectId || !models.some((model) => model.key === config.model)}
            onClick={() => void run(() => window.ptx.feishu.save(config, ''))}
          >
            保存配置
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || !status?.hasSecret || (!status.enabled && dirty)}
            onClick={() => void run(() => (status?.enabled ? window.ptx.feishu.disconnect() : window.ptx.feishu.connect()))}
          >
            {status?.enabled ? '断开连接' : '连接飞书'}
          </button>
          <button
            type="button"
            className="button feishu-forget"
            disabled={busy || !status?.hasSecret}
            onClick={() => {
              if (!window.confirm('确定清除飞书配置？已保存的应用信息和密钥会被删除，需要重新扫码绑定才能连接。')) return
              void run(() => window.ptx.feishu.forget())
            }}
          >
            清除配置
          </button>
        </div>
        {error || status?.error ? (
          <p className="settings-error" role="alert">
            {error || status?.error}
          </p>
        ) : null}
      </div>
      <div className="settings-group">
        <h2>在飞书开放平台配置</h2>
        <ol>
          <li>创建企业自建应用并启用机器人。</li>
          <li>开通单聊消息读取权限 im:message.p2p_msg:readonly 、发送权限 im:message:send_as_bot，以及流式卡片权限 cardkit:card:write。</li>
          <li>在这里保存并连接，再在飞书选择长连接接收事件，订阅 im.message.receive_v1。</li>
          <li>发布应用，确认你的账号在可用范围内。同一应用仅连接一台电脑。</li>
        </ol>
        <p>
          在手机机器人单聊发送 普通文字即可继续当前会话，使用 <code>/状态</code>、<code>/结果</code>、<code>/停止</code> 管理当前会话，使用 /新建、/会话、/切换 会话ID
          创建或切换会话。完成后回到桌面验收，需交互确认的任务也在桌面处理。
        </p>
      </div>
      {binding ? (
        <FeishuBindingDialog
          target={{ harness: config.harness, projectId: config.projectId, model: config.model }}
          targetFields={
            <div className="feishu-fields">
              <label className="field">
                <span>绑定引擎</span>
                <select
                  value={config.harness}
                  onChange={(event) => {
                    if (event.target.value === 'pi' || event.target.value === 'omp') setConfig({ ...config, harness: event.target.value, projectId: '', model: '' })
                  }}
                >
                  <option value="pi">Pi</option>
                  <option value="omp">OMP</option>
                </select>
              </label>
              <label className="field">
                <span>绑定项目</span>
                <select value={config.projectId} onChange={(event) => setConfig({ ...config, projectId: event.target.value })}>
                  <option value="">选择项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>绑定模型</span>
                <select value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })}>
                  <option value="">选择模型</option>
                  {models.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          }
          onClose={() => setBinding(false)}
          onBound={(value) => {
            setStatus(value)
            setConfig(value.config ?? EMPTY)
          }}
        />
      ) : null}
    </section>
  )
}
