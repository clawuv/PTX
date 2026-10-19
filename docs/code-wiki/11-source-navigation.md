# 11 源码导航与维护

[返回目录](README.md) · [上一章](10-testing-and-release.md)

## 1. 推荐源码阅读顺序

1. [package.json](../../package.json)、[electron.vite.config.ts](../../electron.vite.config.ts)：看运行命令、依赖和三个构建入口。
2. [src/types/api.ts](../../src/types/api.ts)：建立 project/session/runtime/message/API 的共同术语。
3. [electron/main/index.ts](../../electron/main/index.ts)：看应用装配与生命周期。
4. [preload/index.ts](../../electron/preload/index.ts)、[ipc.ts](../../electron/main/ipc.ts)：看进程之间如何通信。
5. [agent-rpc/manager.ts](../../electron/main/agent-rpc/manager.ts) → [runtime.ts](../../electron/main/agent-rpc/runtime.ts) → [harness-adapter.ts](../../electron/main/agent-rpc/harness-adapter.ts)：看代理如何实际运行。
6. [src/App.tsx](../../src/App.tsx) → [useWorkspaceRuntime](../../src/hooks/useWorkspaceRuntime.ts) → [useWorkspaceActions](../../src/hooks/useWorkspaceActions.ts)：看用户动作如何落到 runtime。
7. [sessions.ts](../../electron/main/sessions.ts) → [transcript.ts](../../electron/main/sessions/transcript.ts) → [events/reduce.ts](../../src/lib/events/reduce.ts)：理解历史会话与实时展示。
8. 按专题阅读任务、调度、浏览器、飞书等服务，并同时看对应测试。

## 2. 核心符号速查

下表的路径对应本次分析源码。行号是辅助定位，后续重构应优先按符号名搜索。

### 2.1 主进程与执行

| 符号 | 位置 | 输入/输出与职责 |
| --- | --- | --- |
| `bootstrap` | [index.ts](../../electron/main/index.ts) | 创建服务、连接事件、注册 IPC、打开窗口 |
| `hardenRenderer` | [index.ts](../../electron/main/index.ts) | BrowserWindow → 导航、guest、权限防护 |
| `resolveRendererAssetPath` | [index.ts](../../electron/main/index.ts) | rendererRoot + decodedPath → 合法资源路径或 null |
| `settleShutdown` | [index.ts](../../electron/main/index.ts) | 回收 Promise 集合 → 等待并记录失败 |
| `createHarnessRuntimeMap` | [harness-runtime.ts](../../electron/main/harness-runtime.ts) | 两种服务组 → 冻结的完整 registry |
| `HarnessDiscoveryService` | [harness-discovery.ts](../../electron/main/harness-discovery.ts) | 路径设置 → 可执行文件状态目录 |
| `probeHarnessExecutable` | [harness-discovery.ts](../../electron/main/harness-discovery.ts) | executable → 有界版本/失败信息 |
| `AgentRpcManager` | [manager.ts:21](../../electron/main/agent-rpc/manager.ts#L21) | 一个 harness 的 runtime 所有权与授权入口 |
| `AgentRpcManager.start` | [manager.ts:65](../../electron/main/agent-rpc/manager.ts#L65) | unknown options → 授权 `RuntimeInfo` |
| `AgentRpcManager.command` | [manager.ts:174](../../electron/main/agent-rpc/manager.ts#L174) | runtimeId + unknown command → 验证后的 RPC response |
| `RpcRuntime` | [runtime.ts:73](../../electron/main/agent-rpc/runtime.ts#L73) | 一个 CLI 进程的 transport、pending request 与状态 |
| `RpcRuntime.handshake` | [runtime.ts:162](../../electron/main/agent-rpc/runtime.ts#L162) | 协议协商/状态初始化 → runtime snapshot |
| `FramedRpcTransport` | [transport.ts:20](../../electron/main/agent-rpc/transport.ts#L20) | ChildProcess 标准流 → 有界 JSONL 行与写队列 |
| `AgentEventForwarder.emit` | [events.ts:36](../../electron/main/agent-rpc/events.ts#L36) | 原始事件 → 限流后的 envelope |
| `validateRpcCommand` | [command-schema.ts](../../electron/main/agent-rpc/command-schema.ts) | unknown → 合法命令或异常 |
| `StrictJsonlDecoder` | [jsonl.ts](../../electron/main/jsonl.ts) | 流 chunk → 严格 LF records |
| `runProcess` | [process-utils.ts](../../electron/main/process-utils.ts) | 固定 executable/argv → 有界 `ProcessResult` |
| `safeChildEnvironment` | [process-utils.ts](../../electron/main/process-utils.ts) | 受控环境增量 → 子进程环境 |
| `killProcessTree` | [process-utils.ts](../../electron/main/process-utils.ts) | PID + 终止阶梯 → 是否停止 |

### 2.2 数据、模型与授权

| 符号 | 位置 | 职责 |
| --- | --- | --- |
| `JsonStateStore.update` | [store.ts](../../electron/main/store.ts) | 串行化状态草稿及原子持久化 |
| `openDesktopStateStore` | [store.ts](../../electron/main/store.ts) | v4 加载和平台迁移 |
| `ProjectService` | [projects.ts:141](../../electron/main/projects.ts#L141) | 项目目录、授权、worktree 和脚本记录 |
| `authorizeCwd` | [projects.ts:1020](../../electron/main/projects.ts#L1020) | 显式执行授权 |
| `authorizeReadOnlyCwd` | [projects.ts:1026](../../electron/main/projects.ts#L1026) | 显式/合规推断只读授权 |
| `SessionService` | [sessions.ts:68](../../electron/main/sessions.ts#L68) | 会话 list/read/rename/archive 和监听 |
| `registerPendingSession` | [sessions.ts:138](../../electron/main/sessions.ts#L138) | 注册经过验证但尚未落盘的活动会话 |
| `SessionMetadataCatalog` | [catalog.ts](../../electron/main/sessions/catalog.ts) | 有界元数据缓存和目录协调 |
| `createIncrementalMetadataReader` | [metadata.ts](../../electron/main/sessions/metadata.ts) | 文件追加读取与尾部验证 |
| `createTranscriptReader` | [transcript.ts](../../electron/main/sessions/transcript.ts) | JSONL 树 → `TranscriptMessage[]` |
| `CliModelCatalogService` | [model-catalog-cli.ts](../../electron/main/model-catalog-cli.ts) | TTL、合并刷新、旧目录回退与条目验证 |
| `PiModelCatalogService` | [providers-pi.ts](../../electron/main/providers-pi.ts) | 临时 RPC 模型探测 |
| `OmpModelCatalogService` | [providers-omp.ts](../../electron/main/providers-omp.ts) | CLI JSON 模型探测 |
| `resolveModel`、`resolveReasoning` | [model-selection.ts](../../electron/main/model-selection.ts) | 受限候选集合内的近似选择 |
| `withModelVisibility` | [model-visibility.ts](../../electron/main/model-visibility.ts) | GUI provider/model 隐藏与选择偏好 |

### 2.3 工作流与外部能力

| 符号 | 位置 | 职责 |
| --- | --- | --- |
| `TaskService.start` / `evidence` | [tasks/service.ts](../../electron/main/tasks/service.ts) | 启动开发任务 / 动态收集会话与 Git 证据 |
| `AutomationService` | [schedules/service.ts](../../electron/main/schedules/service.ts) | 持久化 schedule、timer、运行历史、重试 |
| `ScheduledRunExecutor.run` | [schedules/executor.ts](../../electron/main/schedules/executor.ts) | 目标验证、unattended runtime、会话串行化 |
| `nextScheduleOccurrence` | [recurrence.ts](../../electron/main/schedules/recurrence.ts) | timing + after → 下一次时间或 null |
| `CapabilityBridge` | [capability-bridge.ts](../../electron/main/lib/capability-bridge.ts) | scoped loopback 服务公共协议 |
| `AgentBrowserService` | [browser/agent-service.ts](../../electron/main/browser/agent-service.ts) | guest/tab 注册与页面控制 |
| `AgentCollaborationBridge` | [collaboration/agent-bridge.ts](../../electron/main/collaboration/agent-bridge.ts) | 同引擎/目录顶层会话工具 |
| `PluginService` | [plugins.ts](../../electron/main/plugins.ts) | 能力目录及变更服务 |
| `validatePackageSource` | [package-execution.ts](../../electron/main/plugins/package-execution.ts) | package 来源准入 |
| `updateMcpSettings` | [mcp.ts](../../electron/main/plugins/mcp.ts) | 标准 stdio 定义安全写入 |
| `probeMcpServer` | [mcp-probe.ts](../../electron/main/plugins/mcp-probe.ts) | 有界本地 MCP 启动与协议探测 |
| `FeishuService` | [feishu/service.ts](../../electron/main/feishu/service.ts) | 入站队列、命令、流式回复与同步 |
| `admittedMessage` | [feishu/protocol.ts](../../electron/main/feishu/protocol.ts) | 未可信事件 → 合规消息或 null |
| `FeishuConversations.send` | [feishu/conversations.ts](../../electron/main/feishu/conversations.ts) | 绑定会话 → prompt/follow-up |
| `LiveReply.apply` | [feishu/cards.ts](../../electron/main/feishu/cards.ts) | RPC 事件 → 可推送卡片快照 |
| `VoiceService.executeTool` | [voice.ts](../../electron/main/voice.ts) | 受限语音命令 → 项目/模型/启动结果 |

### 2.4 前端与跨进程

| 符号 | 位置 | 职责 |
| --- | --- | --- |
| `registerIpc` | [ipc.ts:120](../../electron/main/ipc.ts#L120) | 服务集合 + renderer URL → 可撤销 IPC 注册 |
| `isTrustedRendererUrl` | [ipc.ts:92](../../electron/main/ipc.ts#L92) | 精确文档 URL 比较，允许 fragment |
| `useBootstrap` | [useBootstrap.ts](../../src/hooks/useBootstrap.ts) | 当前引擎初始目录与运行时 |
| `mergeSessionCatalog` | [useBootstrap.ts](../../src/hooks/useBootstrap.ts) | 磁盘目录与 renderer 生命周期合并 |
| `useWorkspaceRuntime` | [useWorkspaceRuntime.ts](../../src/hooks/useWorkspaceRuntime.ts) | 工作区 generation、转录和运行时绑定 |
| `useWorkspaceActions` | [useWorkspaceActions.ts](../../src/hooks/useWorkspaceActions.ts) | UI 命令到 preload 调用 |
| `useAgentEvents` | [useAgentEvents.ts](../../src/hooks/useAgentEvents.ts) | 全局 runtime 事件路由 |
| `createScopedRequestGuard` | [scoped-request.ts](../../src/app/scoped-request.ts) | 异步读的请求/路径/generation 身份校验 |
| `runTranscriptRead` | [transcript-load.ts](../../src/app/transcript-load.ts) | 统一异步读取生命周期 |
| `reconcileTranscripts` | [transcript-reconcile.ts](../../src/app/transcript-reconcile.ts) | 保持未变消息对象引用 |
| `replayAgentEvents` | [reduce.ts](../../src/lib/events/reduce.ts) | 批事件归并到 transcript |
| `coalesceAssistantTurns` | [Transcript.tsx](../../src/components/Transcript.tsx) | 合并相邻 assistant 展示段 |
| `advanceStreamingParse` | [MarkdownText.tsx](../../src/components/MarkdownText.tsx) | 控制流式 Markdown 解析边界 |
| `I18nProvider` | [i18n/index.tsx](../../src/lib/i18n/index.tsx) | renderer 语言上下文 |

## 3. 其他模块地图

这些模块常被主路径引用，但不必一开始全部通读：

| 模块 | 作用 |
| --- | --- |
| [application-menu.ts](../../electron/main/application-menu.ts) | 原生菜单创建与平台差异 |
| [background.ts](../../electron/main/background.ts) | macOS 菜单栏、登录启动、关闭窗口策略 |
| [crash-guard.ts](../../electron/main/crash-guard.ts) | 异常日志与紧急进程清理 |
| [open-with.ts](../../electron/main/open-with.ts) | 固定编辑器/文件管理器/终端目标 |
| [packaged-smoke.ts](../../electron/main/packaged-smoke.ts) | 打包 readiness marker 契约 |
| [updates.ts](../../electron/main/updates.ts) | 自动检查、状态机、下载和 QA 手动安装 |
| [ui-locale.ts](../../electron/main/ui-locale.ts) | 主进程菜单/提示语言 |
| [settings-schedules.ts](../../electron/main/settings-schedules.ts) | 实际主类是 SettingsService；调度已在 schedules 目录 |
| [voice-permissions.ts](../../electron/main/voice-permissions.ts) | 可信主窗口音频权限判断 |
| [pets.ts](../../electron/main/pets.ts) | 有界只读资源发现 |
| [lib/async.ts](../../electron/main/lib/async.ts) | 合并异步请求与并发接纳工具 |
| [jsonl-limits.ts](../../electron/main/jsonl-limits.ts) | 文件/RPC 统一帧预算 |
| [agent-rpc/types.ts](../../electron/main/agent-rpc/types.ts) | RPC 内部对象类型 |
| [session-attention.ts](../../src/app/session-attention.ts) | 未读/完成/失败注意状态与 revision |
| [turn-anchor.ts](../../src/app/turn-anchor.ts) | 回合与变化卡片稳定锚点 |
| [session-actions.ts](../../src/lib/session-actions.ts) | queue/steer 动作快照与归一化 |
| [session-mentions.ts](../../src/lib/session-mentions.ts) | 标题选择、UUID 路由块及兼容解析 |
| [capability-mentions.ts](../../src/lib/capability-mentions.ts) | 能力输入引用 |
| [mcp-policy.ts](../../src/lib/mcp-policy.ts) | 多入口共享的 MCP slash command 策略 |
| [project-scripts.ts](../../src/lib/project-scripts.ts) | setup/run 流程及单次运行控制 |
| [composer-draft.ts](../../src/lib/composer-draft.ts) | 输入草稿保存/恢复 |
| [terminal-context.ts](../../src/lib/terminal-context.ts) | 终端选区附加上下文 |
| [extension-ui.ts](../../src/lib/extension-ui.ts) | 扩展问卷/对话框事件模型 |
| [settings/draft-state.ts](../../src/pages/settings/draft-state.ts) | 设置表单草稿与提交 |
| [settings/sections.tsx](../../src/pages/settings/sections.tsx) | 设置 section 组织 |

## 4. 按需求定位修改面

| 需求 | 优先修改位置 | 必须连带验证 |
| --- | --- | --- |
| 新增引擎 | HarnessId、HARNESSES、runtime map、adapter、catalog、sessions | IPC scope、store migration、UI 切换、扩展注入 |
| 新 RPC 命令 | schema、adapter、runtime、PtxApi | 非法字段、命令关联、unsupported harness |
| 新会话内容类型 | MessagePart、磁盘 reader、事件 parser/reducer、Transcript | 同内容实时/恢复一致、大小预算 |
| 新项目能力 | ProjectService、固定 IPC、preload、UI | inferred/explicit、移除、symlink、worktree |
| 新页面 | WorkspaceView、App lazy 页面、Sidebar/i18n/styles | 无桥接演示、键盘、窄屏、切引擎 |
| 任务状态变化 | TaskService、TaskStatus、TaskDetail | 重启、重复启动、停止、证据失败 |
| 新调度模式 | ScheduleTiming、recurrence、service、ScheduledPage | 时区、DST、错过执行、revision |
| 新 MCP 支持 | PluginService、mcp writer、catalog、UI | 来源/adapter、竞争写入、网络定义拒绝 |
| 新飞书命令 | protocol、service、conversations/transport | 身份、单聊、去重、项目撤销与外发数据 |
| 新语音 provider | VoiceService、voice types/options/settings | 安全存储、URL、音频预算、无真实 key 测试 |
| 依赖升级 | package + lock + 必要 pin/provenance | 审计、native ABI、ASAR、目标 OS 打包 |

## 5. 历史差异清单

以下用于避免新成员把旧说明当作代码事实，不代表本次修复了这些差异：

| 历史/笼统描述 | 当前源码事实 | 权威入口 |
| --- | --- | --- |
| 支持 Prime/Pi/OMP | 仅 Pi/OMP，Prime 已移除 | `HARNESS_IDS`、runtime map |
| vendored Prime、zeromq | 当前依赖图已移除 | package/lock、prime-removal |
| `prime-work-*` 名字表示仍有 Prime | 多为状态、协议、partition 或转录兼容标识 | store、api、prime-removal |
| 所有 runtime 有同一个固定并发上限 | manager 保留忙碌进程、淘汰空闲；一次性工具与 schedule 分别限流 | manager/process-utils/schedules |
| 所有 TS 项目 strict | scripts tsconfig 明确 `strict:false` | tsconfig.scripts.json |
| `build` 包含完整发布验证 | 仅 typecheck + bundle | package scripts |
| `npm test` 自动检查 coverage | coverage 独立脚本 | package/Vitest |
| 安全说明中的 bundle 数值 | 当前 main 520 KiB、renderer 总计 2320 KiB | size-budgets.mjs |
| 基础 broker 校验 Content-Type | 当前未显式执行该校验 | CapabilityBridge.handle/readBody |
| 飞书只接受 text/image | 还接受受限单图 post | admittedMessage |
| 飞书所有文件操作均限项目 | `/发图` 路径不受项目根包含校验，前置分支另有授权边界 | service/transport |
| 模型目录可用即已登录 | 合法目录模型可选，不验证逐模型认证 | validateModelEntry |
| `.cursor` 云脚本随仓库提供 | 本次文件树不存在该目录 | 仓库目录清单 |

历史设计仍能解释决策背景，但不应复制其中 Prime、daemon、三引擎迁移的旧片段作为新功能实现。

## 6. Wiki 维护规则

1. 每次大版本或架构变化更新首页 commit/date，不保留含糊的“始终最新”表述。
2. API/状态模型改动同步更新对应专题和源码索引。
3. 新网络入口记录凭据、身份、外发数据和撤销路径。
4. 运行命令从 package scripts 核对，依赖精确版本从 lock 核对。
5. 源码/设计不一致时说明已知差异，避免静默选择较理想的描述。
6. 文档与测试证据分开：指南列命令，实际验证记录注明 commit/OS/结果。
7. 维护相对链接；重命名模块后检查所有文档引用，行号按需刷新。

本套 Wiki 为仓库结构与关键实现导航，不代替类型定义、测试、现有安全策略或外部 Pi/OMP 协议文档。
