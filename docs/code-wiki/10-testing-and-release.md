# 10 测试与发布

[返回目录](README.md) · [上一章](09-dependencies-and-running.md) · [下一章](11-source-navigation.md)

## 1. 验证原则

[docs/validation.md](../validation.md) 是流程指南，[package.json](../../package.json) 和 `.github/workflows/` 是实际执行定义。一次通过只证明该 commit、runner、输入和凭据下的结果，不证明未来提交、所有平台或真实服务均通过。

本次生成 Wiki 没有执行完整测试、构建、E2E、审计或打包，以下是源码核对后的运行方式。

## 2. 命令表

| 命令 | 实际覆盖 |
| --- | --- |
| `npm run typecheck` | node、web、tests、scripts、extensions 五个 tsconfig |
| `npm run lint` | Biome 配置选定的源码/测试/扩展/脚本 |
| `npm run format:check` | package script 指定的发布脚本及若干配置/测试文件，不是全仓库格式化 |
| `npm run check` | lint + format:check |
| `npm test` | `vitest run`，不默认开启 coverage |
| `npm run test:coverage` | Vitest V8 coverage + 阈值 |
| `npm run test:watch` | Vitest 监听 |
| `npm run test:e2e` | build 后运行 Electron Playwright |
| `npm run test:e2e:hermetic` | 仅 Playwright，调用前需存在匹配构建 |
| `npm run build` | typecheck + production bundle |
| `npm run release:bundle-size` | 工具链 preflight + bundle 体积检查 |
| `npm run release:verify:package` | 工具链、类型、代码检查、覆盖率、bundle、体积 |
| `npm run release:verify` | 上一项 + hermetic E2E |
| `npm run audit:production` | 联网生产依赖审计 + 有期限例外策略 |

`release:verify:package` 名字里虽有 package，但不会生成安装包，也不运行 E2E。

## 3. TypeScript 边界

| 配置 | 主要范围 | 特点 |
| --- | --- | --- |
| [tsconfig.node.json](../../tsconfig.node.json) | Electron 与共享类型、electron-vite 配置 | Node/Electron 类型，strict |
| [tsconfig.web.json](../../tsconfig.web.json) | `src/**/*.ts(x)` | DOM、React JSX、`@` alias，strict |
| [tsconfig.tests.json](../../tsconfig.tests.json) | tests 与测试配置 | Node+DOM、允许 JS 引用，strict |
| [tsconfig.scripts.json](../../tsconfig.scripts.json) | release TS/MJS/CJS | allowJs + checkJs，当前 `strict: false` |
| [tsconfig.extensions.json](../../tsconfig.extensions.json) | bundled extensions | Node/ES2022，strict |

工程规则说“strict throughout”是总体约定，但当前 scripts 配置有明确例外。扩展类型检查独立存在，因为它们不是 renderer 模块。

## 4. 测试结构

[vitest.config.ts](../../vitest.config.ts) 默认 Node 环境，匹配 `tests/**/*.test.{ts,tsx}`；前端需要 DOM 的文件可指定 jsdom。E2E 在独立 Playwright 配置，不属于 Vitest 用例。

| 测试域 | 典型文件 | 主要目标 |
| --- | --- | --- |
| RPC 与适配器 | [agent-rpc.test.ts](../../tests/backend/agent-rpc.test.ts)、[pi-agent-rpc.test.ts](../../tests/backend/pi-agent-rpc.test.ts)、[omp-agent-rpc.test.ts](../../tests/backend/omp-agent-rpc.test.ts) | framing、命令、启动/退出、协议差异 |
| IPC/安全 | [ipc-security.test.ts](../../tests/backend/ipc-security.test.ts)、[preload-contract.test.ts](../../tests/backend/preload-contract.test.ts) | 来源、固定契约、拒绝路径 |
| 项目与 Git | [projects.test.ts](../../tests/backend/projects.test.ts)、[git-guards.test.ts](../../tests/backend/git-guards.test.ts) | grant、目录身份、命令边界 |
| 会话 | [session-catalog-reconcile.test.ts](../../tests/backend/session-catalog-reconcile.test.ts)、[transcript.test.ts](../../tests/backend/transcript.test.ts) | 增量目录、转录树、读取预算 |
| 状态迁移 | [store-windows-migration.test.ts](../../tests/backend/store-windows-migration.test.ts)、[retired-harness-migration.test.ts](../../tests/backend/retired-harness-migration.test.ts) | schema 与授权保全 |
| Tasks | [tasks.test.ts](../../tests/backend/tasks.test.ts)、[tasks-page.test.tsx](../../tests/frontend/tasks-page.test.tsx) | 任务状态、并发、证据与 UI |
| Schedule | [automation-service.test.ts](../../tests/backend/automation-service.test.ts)、[schedule-executor.test.ts](../../tests/backend/schedule-executor.test.ts) | 时间恢复、重试、目标校验 |
| 飞书 | [feishu.test.ts](../../tests/backend/feishu.test.ts)、[feishu-transport.test.ts](../../tests/backend/feishu-transport.test.ts) | 消息授权、去重、会话和传输 |
| 语音 | [voice.test.ts](../../tests/backend/voice.test.ts)、[voice-orb.test.tsx](../../tests/frontend/voice-orb.test.tsx) | 凭据、工具路由和交互 |
| 前端并发 | [renderer-concurrency.test.tsx](../../tests/frontend/renderer-concurrency.test.tsx)、[harness-switching.test.tsx](../../tests/frontend/harness-switching.test.tsx) | generation 与作用域隔离 |
| 渲染性能 | [streaming-performance.test.ts](../../tests/frontend/streaming-performance.test.ts)、[bundle-boundaries.test.ts](../../tests/frontend/bundle-boundaries.test.ts) | 流式批处理、lazy 边界 |
| 原生应用 | [app.spec.ts](../../tests/e2e/app.spec.ts) | hermetic Electron UI |
| 发布契约 | [release-scripts.test.ts](../../tests/release-scripts.test.ts) | 依赖 pin、打包、发布入口 |

### 4.1 定向测试

修改相关功能时先运行相应集合：

```bash
npx vitest run tests/backend/tasks.test.ts tests/backend/preload-contract.test.ts tests/frontend/tasks-page.test.tsx
```

```bash
npx vitest run tests/backend/pi-agent-rpc.test.ts tests/backend/omp-agent-rpc.test.ts
```

然后选择与最终结论匹配的聚合检查，不把单个测试文件通过写成“全套测试通过”。

### 4.2 覆盖率

[coverage-inventory.ts](../../scripts/release/coverage-inventory.ts) 明确管理源文件清单与功能家族阈值。当前 Vitest 全局基准：

- statements 65%。
- branches 50%。
- functions 70%。
- lines 75%。

同时应用 `familyCoverageThresholds()`，不能仅追求总比例而忽略某个安全敏感家族。报告输出 text、HTML、JSON summary，失败时也生成报告。

## 5. Electron E2E

[playwright.config.ts](../../playwright.config.ts) 使用单 worker、非全并行、每条 75 秒 timeout、expect 8 秒、失败重试 1 次并保留失败 trace。

```bash
npm run test:e2e
```

只测一个任务 UI 场景：

```bash
npm run build
npx playwright test tests/e2e/app.spec.ts -g 'creates a task'
```

Linux 无显示环境可在满足系统依赖后使用：

```bash
xvfb-run -a npm run test:e2e
```

hermetic fixture 隔离用户目录、项目和 CLI，不使用真实模型账户。因此它验证应用流程，不证明任意模型输出质量、供应商图片理解或飞书企业实际可用。

## 6. CI

当前 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)：

| Job | Runner/条件 | 作用 |
| --- | --- | --- |
| `production-audit` | Ubuntu；PR/main/手动 | 对准确提交执行带例外的生产审计 |
| `quality` | Ubuntu；PR/main/手动 | 类型、Biome、coverage、bundle、体积 |
| `hermetic-e2e` | macOS；PR/main/手动 | 构建 + 原生 Electron E2E |
| `windows-state-migration` | Windows Server；PR/main/手动 | 真实 Windows 迁移 |
| `packaging-smoke` | PR only；mac arm64/linux x64/win x64 | 原生 unpacked 包；Linux/Windows 还执行结构与启动 smoke |
| `local-qa-package` | 手动 only | 三平台本地 QA 安装包 |

Job 的定义不证明远端 branch protection 已配置；所需状态上下文是 GitHub 仓库设置，需要授权后独立检查。本次没有查询远端 CI 或分支保护状态。

## 7. 发布脚本

| 文件 | 职责 |
| --- | --- |
| [bootstrap-npm.mjs](../../scripts/release/bootstrap-npm.mjs) | 校验 vendored npm 包并准备工具链 |
| [preflight.mjs](../../scripts/release/preflight.mjs) | 工具链、环境与分发前提检查 |
| [install-app-deps.mjs](../../scripts/release/install-app-deps.mjs) | Electron 平台安装与原生模块重建 |
| [package.mjs](../../scripts/release/package.mjs) | QA/public 平台打包编排 |
| [after-pack.cjs](../../scripts/release/after-pack.cjs) | 打包后处理与 Electron fuses |
| [verify-package.mjs](../../scripts/release/verify-package.mjs) | macOS 包、信任、布局和预算 |
| [verify-cross-platform-package.mjs](../../scripts/release/verify-cross-platform-package.mjs) | Linux/Windows 原生布局与平台验证 |
| [smoke-packaged-app.mjs](../../scripts/release/smoke-packaged-app.mjs) | 启动真实打包应用并检查可信 renderer 就绪标记 |
| [verify-bundle-size.mjs](../../scripts/release/verify-bundle-size.mjs) | 生产 bundle 预算 |
| [validate-release-tag.mjs](../../scripts/release/validate-release-tag.mjs) | tag、版本和 main ancestry |
| [audit-production.mjs](../../scripts/release/audit-production.mjs) | registry-backed 生产审计 |
| [verify-testing-assets.mjs](../../scripts/release/verify-testing-assets.mjs) | 测试发行资产与更新 feed 校验 |

## 8. 原生与包体积

每个平台只解包自身所需的 node-pty `.node/.dll/.exe` 及 helper 文件，不能为了让程序“能启动”而大范围 ASAR 解包。

Electron fuses 禁止 RunAsNode、NODE_OPTIONS、调试 CLI 等额外执行入口，启用 cookie 加密、ASAR integrity、OnlyLoadAppFromAsar。正式测试不得通过关闭这些保护替代真实包验证。

当前 [size-budgets.mjs](../../scripts/release/size-budgets.mjs) bundle 预算：

| 指标 | 上限 |
| --- | ---: |
| main | 520 KiB |
| preload | 16 KiB |
| 初始 renderer | 1,280 KiB |
| 单个 renderer JS/CSS chunk | 600 KiB |
| renderer JS/CSS 合计 | 2,320 KiB |

注意这些与旧 `security.md` 中的 main/renderer 数字不同，执行脚本才是当前值。上调预算要记录测量与原因，不通过随意扩大预算掩盖增长。

## 9. 测试发行与正式发行

三个入口不能混淆：

1. 本机 `package:*:local-qa`：在目标 OS 生成 QA 包，不声称正式签名信任。
2. [testing-platforms.yml](../../.github/workflows/testing-platforms.yml)：显式测试发行工作流，检查 tag/资产并发布 prerelease。
3. [release.yml](../../.github/workflows/release.yml)：正式发行验证、不可变 SHA、审计与原生签名配置。

正式 macOS 需要外部 Developer ID、notarization/stapling；Windows 签名需要配置及期望证书身份。未签名测试发行不是“通过正式门禁”的等价替代。当前自动签名发布还受 `RELEASE_SIGNED_ENABLED` 等工作流条件控制，不能只创建 tag 就假定一定签名发布。

[testing-release.md](../testing-release.md) 含历史 QA 限制与后续测试发行流程，阅读时注意时间和 commit，不能引用旧运行结果作为本文基线验证。

`--packaged-smoke=<absolute marker>` 只用于打包应用诊断：等待 renderer 正常完成授权 `app:get-meta`，写入有界 marker 后退出，不新增绕过安全门禁的 IPC。

## 10. 审计与证据

`npm run audit:production` 读取 npm 生产依赖审计结果，对未接受的 high/critical 失败。例外文件 [audit-exceptions.json](../../scripts/release/audit-exceptions.json) 有明确 advisory、包、理由和到期时间；过期或失效的例外也会失败。

审计通过不能改写为“零漏洞”。依赖升级需核对 lock、override、vendored 工具链 pin 与生产 native 包。

提交验证结论时至少记录 commit、工作区状态、OS/架构、Node/npm、准确命令/退出码、跳过项、真实/模拟服务、签名状态及产物 hash。
