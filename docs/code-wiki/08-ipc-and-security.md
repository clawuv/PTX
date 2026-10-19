# 08 IPC 与安全边界

[返回目录](README.md) · [上一章](07-feishu-and-voice.md) · [下一章](09-dependencies-and-running.md)

## 1. 安全模型

三个不同的信任边界：

1. **React → Electron Main**：固定 preload API、精确主框架 URL、sender 授权。
2. **Harness → 本地能力**：runtime 级 token、作用域、速率和输入预算。
3. **远程网页/飞书/模型文本 → 本机**：不可信内容解析、身份、授权、路径及输出限制。

更完整的原安全约定见 [security.md](../security.md)。本文结合当前源码解释边界，不构成“已审计无漏洞”的声明。

## 2. Preload 契约

[electron/preload/index.ts](../../electron/preload/index.ts) 构造 `PtxApi`，冻结所有 domain 以及顶层对象，最终：

```ts
contextBridge.exposeInMainWorld('ptx', Object.freeze(api))
```

renderer 只能使用明确声明的方法。没有通用 `invoke(channel)`、Node `fs`、shell 或完整 Electron 对象暴露。

`subscribe()` 仅把事件 payload 传给回调，不暴露原始 Electron event，并返回取消订阅函数。对象型事件做最基本的对象检查；业务字段仍需在主进程产生端和对应消费端遵守契约，不能将 TypeScript 类型当成运行时验证器。

`invoke()` 对 Electron 包装错误做有限解包并保留 cause，便于 UI 展示真实错误。

## 3. IPC 信任门禁

[registerIpc](../../electron/main/ipc.ts) 中的 `verify(event)` 要求：

- 注册未关闭。
- sender ID 已被 `authorize()` 登记。
- sender 未销毁。
- `senderFrame === sender.mainFrame`。
- senderFrame URL 与 sender 当前 URL 都匹配期望 renderer URL。

`isTrustedRendererUrl()` 忽略 fragment，其余 URL 必须完全匹配，不是仅同 origin。主进程在可信页面加载完成后授权，在异常导航、renderer 丢失、窗口关闭和退出时撤销。

所有固定 `handle()` 和 `on()` 注册都经过 verify。`dispose()` 清除 handler/listener、停止订阅并撤销授权。代理事件、更新事件向外发送前也重新检查可信 URL。

## 4. API 域与路由

权威 API：[PtxApi](../../src/types/api.ts)、[TasksApi](../../src/types/tasks.ts)、[FeishuApi](../../src/types/feishu.ts)。

| API 域 | 代表方法/通道 | 主进程所有者 | 关键约束 |
| --- | --- | --- | --- |
| `app` | `getMeta/refreshHarnesses/openExternal/openWith` | 生命周期、discovery、open-with | 固定目标与 URL/path 验证 |
| `updates` | `getState/check/downloadAndInstall` | `UpdateService` | 打包构建状态、用户下载安装动作 |
| `projects` | `list/add/remove/listFiles/createWorktree` | 按 harness 的 `ProjectService` | 显式/只读授权、目录身份 |
| `sessions` | `list/read/rename/archive` | 按 root/path 的 `SessionService` | canonical session path，pending 特例 |
| `agent` | `start/command/stop/list` | `AgentRpcManager` | harness/runtime 所有权与命令 schema |
| `providers` | `catalog/setEnabled/setModelEffort` | catalog + settings | 引擎可见性，不是登录管理 |
| `terminal` | `create/input/resize/kill` | `TerminalService` | WebContents owner、目录/会话授权 |
| `git` | `status/diff/stage/commit/push` | `GitService` | 区分只读与写授权，固定 argv |
| `plugins` | `install/connectMcp/probeMcp/mutateCapability` | `PluginService` | 来源、作用域、适配器、stdio 边界 |
| `settings` | `get/update/resetBrowserData` | `SettingsService` | patch 白名单和配置验证 |
| `browser` | `state/attachTab/selectTab/navigateTab` | `AgentBrowserService` | 通过审批的 guest 与 tab |
| `schedules` | `create/update/pause/resume/runNow` | `AutomationService` | 目标/模型/prompt/版本验证 |
| `tasks` | `create/start/accept/revise/evidence` | `TaskService` | 任务状态机及显式项目 |
| `feishu` | `binding-begin/connect/disconnect/status` | `FeishuService` | 主进程凭据，限定应用账号 |
| `voice` | `transcribe/createRealtimeCall/executeTool` | `VoiceService` | 输入预算、provider、工具白名单 |
| `pets` | `list/sprite` | `PetService` | 只读且有界的资源发现 |

### 4.1 路由不是信任客户端声明

- `agent:start` 从输入提取并验证 harness，余下字段交给 manager 验证。
- `agent:command/stop` 根据哪个 manager 实际拥有 runtime ID 路由。
- `sessions:read/rename/archive` 用各引擎 canonical root 验证路径，而不是字符串中出现 `.pi` 就判定 Pi。
- `git/terminal` 使用装配的共享授权函数，不提供随意越过 grant 的入口。
- `tasks.list` 是跨项目/引擎列表，任务自身保存 harness；schedule 的列表入口可按当前引擎过滤。

### 4.2 事件通道

| 通道 | 载荷/用途 |
| --- | --- |
| `agent:event` | `AgentEventEnvelope {runtimeId,event}` |
| `sessions:changed` | `SessionChangeEvent`，包含 harness 及可选 filePath |
| `terminal:data/exit` | PTY 输出与退出 |
| `browser:changed/pointer/activity` | 标签状态、agent 光标和活动 |
| `schedules:changed/focus` | 定义/运行变化与通知跳转 |
| `updates:changed` | `AppUpdateState` |
| `app:open-settings` | 无载荷导航信号 |

终端输入、尺寸和当前上下文用 `ipcRenderer.send` 单向事件；其他大多数方法使用 invoke。单向事件仍经过相同来源门禁。

## 5. 路径与命令安全

[validation.ts](../../electron/main/validation.ts) 提供字段、长度、ID、URL、现存路径等原语；[projects.ts](../../electron/main/projects.ts) 将这些原语组合成具有 grant 和目录身份的授权；[session-paths.ts](../../electron/main/session-paths.ts) 负责会话路径相关规范化。

主进程不得根据 renderer 传来的 `readOnly: false` 或项目名称直接放行。执行授权必须使用当前状态重新检查。

内部工具通过 [runProcess](../../electron/main/process-utils.ts) 执行固定 executable 与 argv：

- `safeChildEnvironment()` 过滤危险进程环境。
- `prepareExecutableSpawn()` 处理平台启动约束。
- 输出字节与超时有界。
- 一次性进程池当前并发 8，等待队列 64；这不等于 agent runtime 并发上限。
- `killProcessTree()`、`stopChildProcesses()` 配合退出回收。

PTY 本来就是用户交互 shell，用户选择启用第三方能力后也会以自身 OS 权限执行。安全模型保护的是来源/准入/范围，不是声称所有工具“无副作用”。

## 6. 内容与网络

| 输入 | 处理方式 |
| --- | --- |
| 模型 Markdown | 不启用 raw HTML，不自动加载远程图片，链接走受限外部打开 |
| JSONL | 严格分帧，大小/数量有界，转录只读 |
| RPC 命令 | 白名单与字段验证，再按适配器翻译 |
| Browser Guest | Node/preload 禁用、独立 partition、导航和下载限制 |
| 协作消息 | HMAC 验证后才用 agent 来源样式 |
| MCP 定义 | 仅支持本地 stdio 写入，认证仍由 harness 负责 |
| 飞书事件 | 应用账号、单聊、时间、重复及内容验证 |
| 音频/SDP | 主进程长度/类型检查，受限 endpoint |

Ptx 会连接网络的场景包括更新、能力安装、Git 远程、飞书、语音和浏览器；Pi/OMP 另有各自网络与模型调用。`telemetry: false` 默认值不意味着应用完全不联网。

## 7. 凭据与持久化

- Pi/OMP 模型凭据由 CLI 管理，Ptx 不读取 auth 文件或数据库。
- 飞书与语音凭据通过 OS `safeStorage` 加密，不在 status IPC 返回原值。
- capability token 注入 scoped child environment，不发送给 renderer。
- 会话协作签名 key 留在 userData，仅主进程使用。
- 原子 JSON 写入不能被笼统描述为数据库事务或所有跨程序文件操作的锁。
- Windows 迁移兼容协议需要真实 Windows 验证，不能用模拟平台参数替代。

## 8. 需要明确的实现边界

1. 基础 `CapabilityBridge` 实际校验路径、方法、Origin、token、速率、body 大小及 JSON；当前未显式校验 Content-Type。
2. 飞书支持受限单图 `post`，不只是文档所述 text/image。
3. 飞书 `/发图` 可读符合条件的本机绝对图片路径，不限项目根，且先于该处理函数后续项目授权分支。
4. 飞书媒体失败日志存在响应/异常警告输出，分享日志须脱敏。
5. 目录模型的 `available` 表示可选择，不保证实际认证。
6. manager 没有固定活动 runtime 数量上限，不能从“各通道有预算”推导出所有资源都受同一上限控制。

这些差异应作为变更/安全评估时的检查点；本次文档没有更改对应行为。

## 9. 新增 IPC 的检查表

1. 在对应 `src/types` 中定义最小 API 和结果类型。
2. preload 只暴露固定方法，订阅必须可取消。
3. 在 `registerIpc` 的统一 handle/on 包装内注册。
4. 主进程验证所有 unknown 输入、路径、所有权与预算。
5. 失败后清理已获取的资源，不静默创建第二个授权入口。
6. 添加 preload contract、IPC 来源/负例、服务授权及功能测试。
7. 更新本 Wiki 的 API 域和相关调用链，检查文档与源码是否一致。
