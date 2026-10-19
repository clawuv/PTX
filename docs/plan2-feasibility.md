# PTX plan2 可行性评估

分析日期：2026-10-19。源码基线：`ff4c25f502b9ce043d02b842fece7975b56b9c0f`。

评估对象：[plan2.md](plan2.md)。本次仅新增方案文档，不修改原文、产品代码、许可证或既有商业承诺。

配套交付：

- [完整技术实现方案](plan2-implementation.md)：接口、数据、接入协议、计量、审批、同步、治理及收费架构。
- [实施任务与验收计划](plan2-delivery-plan.md)：阶段门槛、工作量、依赖、测试、发布和停止条件。
- [现有 Code Wiki](code-wiki/README.md)：当前实现，不是本文拟建能力。

## 1. 结论

**“用户自带模型服务，PTX 为工作流、可靠性和协作体验创造价值”可行；plan2 不能原样作为立项或商业承诺。**

主要问题不是“能不能做界面”，而是：

1. 竞品差异化证据偏弱，部分事实已经与官方资料冲突。
2. 当前适配层专门服务 Pi/OMP，不是任意 CLI 的通用宿主。
3. 订阅认证、远程授权、审计完整性、费用口径都有原方案忽略的边界。
4. 团队治理、端到端加密同步、支付和市场，是多项独立产品，不是几周内的附加功能。
5. 仓库已有个人任务工作流验证路线，不能未经决策改为优先建设企业平台。

推荐定位：

> 面向中文个人开发者及小团队的、本地优先的多引擎开发任务工作台，重点降低任务切换、结果检查和待确认事项处理的成本。

“多引擎”是支撑手段，不是唯一卖点；“支持几个品牌”不能代替留存和付款证据。

## 2. 优先级最高的发现

### F01：订阅接入不是“调用 CLI 就天然允许”

**严重度：阻断原商业承诺。** 对应原文 [L27](plan2.md#L27)、[L60-L63](plan2.md#L60-L63)。

- Anthropic Agent SDK 官方说明：未经批准，第三方开发者不得为自己的产品提供 claude.ai 登录或其订阅额度，应使用 API key 等批准的认证方式。SDK 产品标识还有品牌要求，不得把集成项直接命名成 “Claude Code”。
- OpenAI 当前 App Server 文档的 Auth endpoints 说明区分本地/开源应用与商业/托管服务：不能把旧 App Server authentication 直接用于后者；官方推荐评估 Sign in with ChatGPT。
- Sign in with ChatGPT 的开放范围和权限不是无条件通用。官方 cookbook 写明首发范围包括开源、本地个人项目及选定私有应用；商业伙伴资格需要确认。
- 新的 Codex 接入指南要求应用自行获取、续期并向子进程传递其 OAuth access token。这不同于“PTX 完全不管理任何模型访问凭据”。

**修改方案：** 接入拆成协议 PoC、认证/商业资格确认、产品发布三步。未取得适用资格，不宣传“已有 Claude/ChatGPT 订阅直接在 PTX 商业版使用”。不把用户在外部先登录当作规避条款的办法。

推荐技术先评估 Codex App Server 的 stable stdio，但不提前保证其某种认证路径可商用。Claude Agent SDK API 模式在凭据边界、依赖条款和品牌确认后再做。

依据：S01、S02、S08、S09、S10。上述是工程风险判断，不代替律师或服务商书面确认。

### F02：“加持久化即可获得不可篡改完整审计”不成立

**严重度：阻断企业安全宣传。** 对应原文 [L35-L38](plan2.md#L35-L38)。

[AgentEventForwarder](../electron/main/agent-rpc/events.ts) 会按数量、单包和窗口字节丢弃事件；当前任务、飞书与 renderer 接收的是这条转发路径。即使前移收集，也只能看到 harness 报告的事件，不能保证看到每次实际文件写入、外部 Git、hook 和用户直接终端动作。

本机同一用户拥有软件、文件和签名材料时，哈希链不能证明“本机记录无法伪造/删除”，最多配合独立远端锚点使部分修改可检测。

**修改方案：** 首版称“PTX 接纳操作记录与可观测代理事件”。企业版区分 observe/advisory 与 managed/enforced，要求受控端点、工具执行前拦截、远端追加存储及缺口告警。不得声称覆盖 PTX 外的任意 OS 行为。

### F03：同步项目授权和集中下发本机权限会破坏现有边界

**严重度：安全设计必须重做。** 对应原文 [L36](plan2.md#L36)、[L42](plan2.md#L42)。

[ProjectService](../electron/main/projects.ts) 的权限依赖本机 canonical path、inode、birth time 和显式用户授权。把 A 设备的路径/grant 同步到 B 设备，不证明 B 设备上的同路径属于同一个目录。

**修改方案：** 只同步无执行权的逻辑项目 ID、显示名称、模板和任务镜像。每台设备独立选择目录并生成本机 grant。团队策略默认只能进一步限制已有权限，不能通过云消息静默扩大本机访问范围。

### F04：竞品 GUI、云端和移动能力不是空白

**严重度：差异化与获客假设需要重验。** 对应原文 [L17-L25](plan2.md#L17-L25)、[L43](plan2.md#L43)、[L60](plan2.md#L60)。

官方资料显示：

- Claude Code 已有终端、IDE、桌面和浏览器形态，并有云端会话与手机 Remote Control。
- Codex app 已提供并行线程、worktree、Git、终端、自动化和内嵌浏览器。
- Codex 支持 custom model providers，不能笼统写“技术上只绑 OpenAI”；Claude 也有多种官方基础设施接入方式。

所以“GUI 是厂商短板”“云并行独有”“移动三家都没做好”“唯一同时支持两家”不能作为未经市场验证的结论。厂商模型能力/份额/生态大小也不能仅凭主观口碑排序。

**修改方案：** 对比具体用户任务的完成时间、错误、上下文丢失和验收成本。多引擎统一检查流程、中文本地使用体验和可解释的数据边界是可测试的假设，不是已成立护城河。

依据：S03、S04、S05、S06。

### F05：MIT 允许销售软件，“核心无法收费”是事实错误

**严重度：商业模式判断错误。** 对应原文 [L29-L33](plan2.md#L29-L33)、[L65](plan2.md#L65)。

[LICENSE](../LICENSE) 明确包含 `sell copies of the Software`。MIT 允许商业销售、维护服务和分发；同时允许满足条件的他人复制、修改和再分发，不能靠现有代码排他授权获得垄断。

**修改方案：** 保留许可证和声明，收费价值可来自维护、服务、可靠发行和独立新增能力。若新增专有模块，先明确版权归属、文件/仓库边界及独立许可，不追溯收回既有 MIT 权利。

### F06：已有上下文计数不是成本账本

**严重度：计费展示容易误导。** 对应原文 [L45-L47](plan2.md#L45-L47)。

[LiveContextUsageTracker](../electron/main/agent-rpc/context-usage.ts) 有字符数除以 4 的估算逻辑，目的是实时显示上下文/输出变化。它不是供应商账单，也没有处理跨恢复去重、订阅、缓存计价、价格版本及漏报。

官方资料本身还存在需要实测澄清的口径：Claude headless 文档描述恢复后 total 包含前次花费；当前 Agent SDK cost guide 描述每次 query 的结果反映该 call。不能以一个 `total_cost_usd` 字段名推断所有模式和版本相同。

**修改方案：** 使用独立用量账本，区分 supplier-reported usage、estimated cost、subscription allocation、unknown；为每个固定引擎版本明确 call/session/step 口径。结果中 `null` 不转为 0，不把订阅折算费用展示成实际扣款。

依据：S07、S11、源码及相关测试。

### F07：现有跨 harness 能力不等于跨品牌通用协议

**严重度：开发工作量被低估。** 对应原文 [L23-L25](plan2.md#L23-L25)、[L60](plan2.md#L60)。

- `HarnessId` 只有 `pi/omp`；[HarnessRuntime](../electron/main/harness-runtime.ts) 依赖具体 `AgentRpcManager/SessionService/PluginService`。
- [RpcRuntime.handleFrame](../electron/main/agent-rpc/runtime.ts) 要求 Pi/OMP 的 `type/id/command/success`；Codex 使用双向 JSON-RPC method/params。
- 当前 `SessionRecord.filePath` 是必填，无法直接表示纯 thread ID。
- 当前跨会话协作限定同 harness、同 canonical cwd，不是跨品牌会话自动互通。
- bundled TypeScript extensions 不能原样加载进任意厂商 CLI。

**修改方案：** 保留 Pi/OMP 实现，上提 session/runtime/provider/interaction 契约。Codex 使用独立协议 driver；Claude SDK 在隔离 worker 内运行；不支持的能力在 UI 明示降级。

### F08：移动入口已有基础，但“远程批准”不是补一个按钮

**严重度：有状态执行安全问题。** 对应原文 [L41-L43](plan2.md#L41-L43)。

现有 [FeishuService](../electron/main/feishu/service.ts) 已能继续本机会话、同步结果及停止任务，不能把这全部列为未来新增收费功能。但待回答请求主要由 [useExtensionUi](../src/hooks/useExtensionUi.ts) 在 renderer 中持有；没有主进程唯一决策源、跨端抢答去重或远程签名决策模型。

问卷不是权限审批。OMP 的具体审批事件仍需固定版本测试，Pi 通用 extension UI 也不能证明每次工具执行都可拦截。

**修改方案：** 先建设主进程 interaction registry，区分 question/approval。支持已验证原生审批的引擎才能远程放行，其余只通知、问答和停止；默认拒绝扩大权限与永久允许。

### F09：原计划优先级与现有三个月承诺冲突

**严重度：资源和商业验证风险。** 对应原文 [L35-L62](plan2.md#L35-L62)。

[plan1](plan1.md)、[validation-playbook](business/validation-playbook.md) 已明确中文个人开发者、每周 20 小时，其中开发 12 小时，先验证任务与验收；团队、云、新引擎暂不开发。

当前没有文档化的真实用户留存、订单或企业合同，不能直接认定“团队治理最容易赚到钱”或“移动批准应当第一付费 SKU”。

**修改方案：** 默认沿用现有路线；将 plan2 作为有条件扩张设计。新引擎只有在合规可行且用户确实因缺引擎而流失时启动。企业研发以付费设计伙伴和预算负责人为前置条件。

## 3. 六条商业路径的可行性

| 路径 | 技术判断 | 商业判断 | 推荐顺序 |
| --- | --- | --- | --- |
| 统一用量/估算仪表盘 | 高，可在 Pi/OMP 上起步；真实账单需要另一个数据源 | 免费增长/透明度功能比单独收费更合理，仍待验证 | 近期小范围 |
| 签名发行、维护与支持 | 高，大量发布基础已有；缺证书/商户/正式承诺 | 可支持早期收费，但安全更新不应成为旧免费用户付费墙 | 持续基础工作 |
| 定制集成与支持 | 中高，具体协议和资格决定报价 | 有签约客户时最快验证现金流，不应预先堆平台 | 有单再做 |
| 移动伴侣/同步 | 中，飞书复用高，通用 E2EE/审批新建量大 | 已有替代，需证明跨引擎或验收流程的额外价值 | 个人留存后 |
| 团队治理 | 局部中，强制治理低至中，取决于执行拦截与受管设备 | 高客单与长销售周期并存；不能仅用竞品 seat 价格推导 | 设计伙伴后 |
| 插件交易市场 | 技术可做，分发安全/结算/供给运营成本高 | 当前无双边规模证据 | 暂不立项 |

“统一代付多个模型/订阅”不纳入本实现路线。它需要服务商转售资格、财税、结算、拒付与独立凭据设计，并不是成本仪表盘的自然下一步。PTX 软件发票不包含第三方模型消费。

## 4. 推荐产品边界

### 4.1 近期个人版

保留当前聊天、项目、Git、浏览器、基础 schedule、协作、飞书和本地任务预览，不追溯加锁。优先改善任务证据来源、错误状态、恢复和首次使用。

近期新增候选：

- 用量摘要：按项目/任务/引擎分组，明确来源和未知值。
- 任务检查记录：实际验证命令和结果引用；用户人工验收。
- 支持诊断导出：默认脱敏、不含正文/密钥/完整路径。

付费试验继续使用已有工作流维护/支持方案，真实沙盒支付、条款和交付准备好后再收款。不得宣称当前已 MIT 发布的任务页面是未发布专有模块。

### 4.2 条件扩张版

通过对应 Gate 后分别启用：

1. 新引擎支持：Codex stable stdio、Claude Agent SDK API。
2. 移动处理：先已有飞书通道的结构化问答/有限审批验证，再决定通用伴侣。
3. E2EE：先模板/偏好和任务镜像，后可选转录镜像，不同步本机执行权。
4. Team：先共享策略限制与操作记录，再受管环境的强制策略及审计。

这些不是第一版捆绑交付承诺。

## 5. 经济模型与价格

原方案中的 $5–10/月、$25–40/席/月、20–30% 抽成只可视为报价假设；缺少付款和成本证据。竞品价格包含模型、平台、地区、税和促销，不能直接类比纯工作台 seat。

现有报价假设为 ¥199/年、创始首年 ¥99，见商业验证手册。本次不擅自替换。

应按 SKU 单独计算：

```text
每月单用户贡献
  = 实收收入 / 覆盖月数
  - 支付及退款净成本
  - 存储/带宽/连接/通知成本
  - 支持耗时 × 完全小时成本
  - 分摊签名、运维与第三方身份服务成本

盈亏平衡活跃付费用户数
  = 月固定成本 / 正的月单用户贡献
```

示例仅用于敏感性分析：¥199/年约 ¥16.58/月；假设支付/退款 5%、基础设施 ¥2/月、平均支持 5 分钟/月且小时成本 ¥120，则只剩约 ¥3.75/月，尚未覆盖研发固定成本。若支持达到 15 分钟/月，单用户贡献已为负。支持成本比“功能足够多”更能决定低价订阅可持续性。

Team 需另外计入 SSO/SCIM、企业支持、销售、安全评估及定制成本。不能用 5 人试用的意向替代组织采购预算。

## 6. 投入建议

### A. 沿用每周 20 小时

12 周中实际开发约 144 小时，即 3.6 人周（1 人周 = 40 工时）。只能选任务可靠性/付费验证加一个收敛的新切片，不能同时完成新引擎、云、E2EE、治理与支付。

推荐“任务证据与恢复 + 用量技术验证”二者按反馈择重；复杂支付若不具备条件，不用模拟付款冒充真实收入。

### B. 小团队专职扩张

假定两名桌面/协议工程师、一名后端工程师，以及兼职产品、设计、QA、安全/法务。个人扩张 Beta 约 24–39 工程人周，不含所有远期功能；并行后的日历估算约 12–18 周，外部批准、市场验证和招募等待不计入工程工时。

E2EE 全量转录同步另加约 4–7 人周；Team observe 阶段再约 10–16 人周；受管强制治理至少再做独立威胁模型和平台评估，不能在此给固定工期保证。详见交付计划中的拆项。

## 7. 立项判据

| Gate | 通过所需证据 | 不通过时 |
| --- | --- | --- |
| 用户价值 | 10 次访谈、5 次真实任务观察，记录当前阻力与重复频率 | 继续本地可靠性，不扩平台 |
| 认证合规 | 对准确分发形态、认证模式、品牌和条款形成书面结论 | 停止相应新引擎商业发布 |
| 协议可行 | 固定 CLI/SDK 版本真实 trace：恢复、停止、审批、用量、崩溃 | 缩小能力，不写万能 adapter |
| 首次使用 | 10 人中至少 7 人独立完成，至少 5 人次周复用 | 修激活，不追逐新功能 |
| 付费 | 按明确已可交付权益至少 3 笔真实支付，单独记录退款 | 重新访谈与报价 |
| 移动价值 | 经同意观察至少 5 人真实离桌处理，3 人连续两周复用 | 保留已有飞书，不建通用云 |
| Team | 至少 2 个有预算负责人的设计伙伴及书面试点范围 | 不开发 SSO/强审计平台 |

这些人数是内部停止/继续规则，不是市场规模估计；不能凭小样本声称统计显著。

## 8. 资料与证据

以下外部资料在 2026-10-19 读取。官方页面可能保留已过期促销，未把促销当作本日有效事实。没有实际登录、采购、运行真实 Codex/Claude 任务或取得商业许可。

| 编号 | 官方来源 | 用途 |
| --- | --- | --- |
| S01 | [Anthropic Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) | SDK、认证限制、品牌与条款 |
| S02 | [Codex App Server](https://developers.openai.com/codex/app-server.md) | stdio、生命周期、审批、auth 适用范围；使用完整 Markdown，避免页面截断 |
| S03 | [Claude Code overview](https://code.claude.com/docs/en/overview) | 桌面/IDE/web 形态 |
| S04 | [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) | 本机执行与手机控制 |
| S05 | [Codex app](https://developers.openai.com/codex/app/) | GUI、worktree、终端、Git、自动化与浏览器 |
| S06 | [Codex authentication](https://developers.openai.com/codex/auth/) | CLI 认证、凭据所有权、custom providers |
| S07 | [Claude headless](https://code.claude.com/docs/en/headless) | 非交互运行、流式输出、恢复与费用口径 |
| S08 | [Sign in with ChatGPT](https://developers.openai.com/siwc) | 应用资格与权限入口 |
| S09 | [OpenAI 官方接入 cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) | 开放范围及非通用商业开放 |
| S10 | [ChatGPT plan + Codex App Server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) | 应用 token、刷新、进程重启和模型资格 |
| S11 | [Agent SDK cost tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) | message ID 去重、call/step/session 计量 |
| S12 | [Agent SDK user input](https://platform.claude.com/docs/en/agent-sdk/user-input) | `canUseTool`、问卷与审批区别 |
| S13 | [Claude pricing](https://claude.com/pricing) / [Codex pricing](https://developers.openai.com/codex/pricing/) | 价格参考入口，不作为 PTX 定价依据 |

本地依据包括 [安全模型](security.md)、[任务工作流](task-workflow.md)、[飞书说明](feishu.md)、[原商业验证手册](business/validation-playbook.md) 及上述源码链接。

## 9. 最终建议

采纳 plan2 的长期方向，但改成 **本地任务价值验证 → 可靠计量/协议契约 → 有资格的新引擎 → 已验证需求的移动处理 → Team 试点**。

暂不做模型账单代付、默认跨品牌自动共享、云端接管本机授权、插件交易市场，也不以“不可篡改/全动作审计/订阅无缝复用”进行宣传。下一步以配套交付计划中的 Gate 0 为唯一无条件启动项。
