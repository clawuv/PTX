这是产品策略分析，我先快速查一下 2026 年 10 月 Claude Code 和 Codex 的最新形态与定价，避免用过时信息对比：

# PTX vs Claude Code vs Codex：优势对比与变现路径

## 一句话定位

| | 形态 | 模型/账号绑定 | 定价 |
|---|---|---|---|
| **Claude Code** | 终端 TUI + IDE 插件 + 桌面 | 只绑 Anthropic（Claude 订阅或 API） | Pro $20 / Max 5x $100 / Max 20x $200 / Team $20-125 席 |
| **Codex** | CLI + IDE 扩展 + 云端 + 移动 | 只绑 OpenAI（ChatGPT 订阅或 API） | Plus $20 / Pro $100-500 / Business $25-30 席 |
| **PTX（本项目）** | **桌面 GUI 工作台** | **不绑定**——接 Pi/OMP 等 CLI，凭据归 CLI 所有 | 目前 MIT 开源，无付费 |

来源：[Anthropic 定价](https://claude.com/pricing)、[Claude Code 订阅说明](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)、[OpenAI Codex 计划](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)、[chatgpt.com/codex/pricing](https://chatgpt.com/codex/pricing)。

## 三者各自的真实优势

**Claude Code**：模型质量和 agent 能力是第一位的（Claude 在代码任务上的口碑）；生态最大——MCP、Skills、Hooks、子代理、GitHub Actions 集成都是它带起来的；企业渗透率高。订阅制让重度用户成本可预期。

**Codex**：分发是 OpenAI 的王牌——数亿 ChatGPT 用户零成本获得；**云端并行任务**（任务在 OpenAI 服务器跑，不占本地机器）是独有能力；CLI 开源（Rust）+ IDE 扩展 + 移动端全线覆盖；Business 版自带 code review 和 Slack 集成。

**PTX 的真实优势**（基于这个代码库的事实，不是愿景）：

1. **Harness 无关**——这是唯一的结构性差异。Claude Code 锁 Anthropic、Codex 锁 OpenAI，而 PTX 的适配器架构（`agent-rpc/harness-adapter.ts`）意味着**一个 GUI 管多个 agent 品牌**：统一的会话目录、统一的模型切换、统一的事件流。用户换 agent 不换工具。
2. **桌面工作台 vs 终端**：三栏布局、会话侧栏（切换/续接/fork/重命名）、transcript 渲染、inspector 工作面板、内置终端（node-pty）、**agent 可驱动的内置浏览器**、git 变更视图、图片粘贴。Claude Code/Codex 的原生形态是 TUI，GUI 是它们各自补课中的短板。
3. **跨 harness 的能力层**：浏览器桥、计划任务（rrule 定时无人值守运行）、ask-user、跨会话协作、语音、MCP 管理——这些作为注入式扩展在所有 harness 上工作，厂商 CLI 不会帮你做跨品牌的事。
4. **本地优先 + 数据开放**：会话就是磁盘上的 JSONL，MIT 开源可审计。对企业用户和个人（数据主权）都有说服力。
5. **BYO 账号**：用户保留自己已有的 CLI 订阅，PTX 永不碰凭据——采购上没有新的信任成本。

**PTX 的硬伤（要诚实）**：依赖第三方 CLI 存活（上游协议变更 = 维护风险，pi/omp 都是小团队项目）；没有云、没有自己的模型，单机价值上限受限于 CLI；MIT 意味着核心无法直接收费；两家巨头都在补 GUI 短板，垂直深度上第三方永远打不过厂商原生。

## 如何让用户付费

核心原则先立住：**MIT 核心不卖，卖核心之上的“多 agent 工作台”价值**。按可行性排序：

**① 团队治理层（最硬的钱）**——企业为“AI agent 的管控”付费的意愿远超个人为 GUI 付费：
- 集中策略：MCP 白名单、工具权限画像、项目授权的集中下发
- 审计：所有 agent 动作（工具调用、文件写入、git 操作）的不可篡改日志——主进程本来就有完整事件流，加持久化即可
- Seat 管理、SSO、按团队的会话/成本报表
- 定价对标：$25-40/席/月（Codex Business 区间）

**② 云同步 + 移动端伴侣（个人的第一付费点）**：
- 会话历史/设置/项目授权的端到端加密多设备同步（订阅 $5-10/月）
- 手机通知 + 远程批准/续发：计划任务和长任务跑着时人在外面，手机上批一个 tool 调用——这个场景目前三家都没做好，而 PTX 已有 schedule + 事件流基础

**③ 统一计量与成本仪表盘（从免费功能长成付费功能）**：
- 跨 harness 聚合的 token/成本统计、预算告警、按项目分摊——多 harness 用户今天根本没有全局视图，这是适配器架构独有的数据位
- 远期演化为**账单聚合**：PTX 一张发票底下管多个 agent 订阅（需要做 opt-in 的托管凭据，与现有安全不变量冲突，须谨慎设计）

**④ 签名分发 + 自动更新（便利性订阅）**：
- macOS 公证 + Windows 签名 + 自动更新的安装包，$8-10/月或买断；源码永远免费可自己构建。Typora/Warp 模式，验证过可行，但天花板低

**⑤ 插件/技能市场（后期）**：
- 等 DAU 上来后开第三方插件分发，抽成 20-30%。前置于它的条件（用户基数）目前还不具备

**⑥ 定制集成服务（现金流补充）**：
- "把你们的内部 agent 接进 PTX”——适配器架构让这成为可报价的工程而非研究；企业支持合同

## 落地顺序建议

1. **先修护城河再谈钱**：把 harness 适配层做成“接入一个新 CLI 只要 N 天”的成熟框架，甚至考虑第一个外部集成就是 **Claude Code 本身**（它有 headless JSON 输出模式）——"PTX 是唯一能同时跑 Claude Code 和 Codex 的桌面”这个位置一旦占住，①③的付费点全部成立。
2. **③ 的免费版尽快上线**（成本仪表盘）做增长钩子，数据位是自己的，先占住。
3. **② 的移动批准**做第一个付费 SKU（个人 Pro），**① 做企业 SKU**。
4. 风险对冲：紧盯两家厂商的 ToS 是否允许第三方 shell 驱动其 CLI，以及 pi/omp 上游协议变化——适配层测试（你们已有的“对固定 CLI 版本验证协议事实”的做法）是生命线。

一句话：**Claude Code 和 Codex 卖的是“模型订阅”，PTX 应该卖“多 agent 的工作方式”**——个人卖同步与移动，企业卖治理与审计，别试图在核心上收费。