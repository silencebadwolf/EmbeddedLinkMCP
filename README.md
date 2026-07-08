# LinkTerm v2

LinkTerm v2 是一个基于 Electron + TypeScript 的桌面终端 与 MCP 自动化平台，作为旧 Qt/C++ 终端的重写版本。它在单一运行时内同时服务四类用户：**桌面终端用户**（本地 Shell / SSH / 串口）、**嵌入式固件开发者**（终端模式 + sendAndWait + RTT/J-Link 工作流）、**AI Host / MCP 客户端**（通过生产运行时的 61 个 MCP 工具读写同一会话、抓取截图、烧录调试），以及**项目维护者**（pure-TS core、依赖注入式 transport、双向许可证校验）。

- 包名：`linkterm-v2`
- 版本：`0.1.0`
- License：`UNLICENSED`（仓库私有，第三方依赖均已记录归因）
- 包管理器：`pnpm@9.15.0`（必需，**不能用 npm/yarn**）
- Node：`>= 20.0.0`

---

## 当前状态

13 / 13 Phase 全部完成（详见 [`DEVELOPMENT_PLAN.md`](./docs/DEVELOPMENT_PLAN.md)）。

| 阶段 | 状态 |
| --- | --- |
| Phase 0 — 项目脚手架 | 已完成 |
| Phase 1 — 核心 Session / Transcript / WriteQueue | 已完成 |
| Phase 2 — 串口适配器 | 已完成 |
| Phase 3 — SSH + 本地 Shell | 已完成 |
| Phase 4 — MCP 终端工具（8 个） | 已完成 |
| Phase 5 — AI-人共同操作硬化（priority 队列、多订阅 cursor） | 已完成 |
| Phase 6 — Electron Renderer UI（xterm.js + shadcn + i18n） | 已完成 |
| Phase 7 — 嵌入式终端规则 + sendAndWait FSM | 已完成 |
| Phase 8 — 工作区配置持久化（`.linkterm/config.json`） | 已完成 |
| Phase 9 — J-Link MCP 调试面（30 个工具 + NullBackend 兜底） | 已完成 |
| Phase 10 — UI MCP 面（`ui_configure` + `ui_screenshot`） | 已完成 |
| Phase 11 — 双向许可证校验脚本 | 已完成 |
| Phase 12 — 集成覆盖 + 高敏感工具 confirm gate + 性能基线 | 已完成 |

测试：1024 个 Vitest 用例 / 106 个测试文件。

---

## 架构概览

### 进程模型

- **Main Process** 持有所有运行时状态：`SessionManager`、`TranscriptBuffer`、`WriteQueue`、Transport 适配器、MCP Server、`WorkspaceConfigManager`、J-Link backend 抽象、UI bridge。
- **Renderer Process** 是 React + xterm.js 的薄壳，仅通过 `window.linkterm`（由 `src/main/preload.ts` 注入）经 IPC 与主进程交互。
- **MCP Server** 在 Main Process 内运行，与 UI **共享同一个** `SessionManager` 实例 —— 这是「AI 与人对同一会话共同操作」的承载点（需求 §4.5）。
- **IPC Bridge** 用 `ipcRenderer.invoke` / `ipcMain.handle` 做请求/响应；流式 transcript 数据用事件推送。

### 单一序列化点（最重要的不变量）

> 任何对会话的写入 —— 无论来自 UI（`origin='human'`）还是 MCP（`origin='ai'`）—— 都**必须**走 `SessionManager.write` → `WriteQueue` → `ITransport`。

`WriteQueue` 是唯一的串行化瓶颈，保证 AI 与人输入的全局顺序、产生审计踪迹。`TranscriptBuffer` 仅追加，配以单调递增的 sequence cursor；`clear` 也以事件形式入档（`meta.kind: 'clear'`），以保留 AI 的可读历史。**MCP 工具与 IPC handler 不允许直接触碰 transport**（需求 §4.4 / §5.1）。

### MCP 隔离 Surface（生产运行时共 61 个工具）

| Surface | 工具数 | 工具名 | Evidence Kind |
| --- | --- | --- | --- |
| Runtime / Agent | 3 | `restart_mcp_runtime`、`get_agent_runbook`、`get_app_status` | `agent_runbook` / `app_status` |
| Terminal | 8 | `list_sessions`、`open_session`、`close_session`、`write_to_session`、`read_from_session`、`send_and_wait`、`discover_serial_ports`、`get_session_status` | `terminal_output` |
| Workspace | 3 | `init_workspace`、`get_workspace_config`、`update_workspace_config` | `workspace_config` |
| Control Profile | 6 | `init_control_profile`、`get_control_profile`、`inspect_control_profile`、`prepare_control_profile_questions`、`apply_control_profile_answer`、`activate_control_profile` | `workspace_config` |
| Control Workflow | 5 | `run_control_workflow`、`get_control_workflow_job_status`、`read_control_workflow_job`、`cancel_control_workflow_job`、`cleanup_control_workflow_jobs` | `debug_output` |
| Debug (J-Link) | 30 | `probe_detect/connect/disconnect/status`、`jlink_reboot`、`cpu_reset/halt/run/step`、`breakpoint_set/clear/list`、`register_read/write/list`、`memory_read/write`、`flash_download/write/verify/erase`、`rtt_connect/clear/read/search`、`gdb_server_start/stop`、`snapshot_capture`、`crash_diagnose`、`jlink_commander_script` | `debug_output` |
| RTT Log Session | 2 | `open_rtt_log_session`、`diagnose_rtt_log_session` | `terminal_output` / `debug_output` |
| J-Link Device Catalog | 2 | `jlink_device_catalog_search`、`jlink_device_catalog_get` | `debug_output` |
| UI | 2 | `ui_configure`（4-action discriminatedUnion）、`ui_screenshot`（PNG，16 MiB 上限） | `ui_screenshot` |

每个 MCP 工具都返回 `{ success, sessionId?, state?, evidence: { kind, data, cursor }, error?, correlationId, origin: 'ai', schemaVersion }`。

#### 高敏感工具 confirm gate（Phase 12）

下列 7 个 J-Link 工具要求入参显式声明 `confirm: true`，否则返回 `{ code: 'CONFIRMATION_REQUIRED' }` 且 backend 方法**不会被调用**：

`flash_download`、`flash_write`、`flash_erase`、`cpu_reset`、`gdb_server_start`、`jlink_reboot`、`jlink_commander_script`

#### Backend 兜底策略

- 没有真实 J-Link backend 注入时，`createMcpServer` 默认使用 `NullJLinkBackend`，所有 30 个 debug 工具仍会注册，但每次调用返回 `{ code: 'NO_BACKEND' }`。
- 没有 UI bridge 注入时，`ui_configure` / `ui_screenshot` 仍会注册，调用返回 `{ code: 'UI_NOT_AVAILABLE' }`。
- 工作区、控制配置、控制工作流和 J-Link 设备库工具依赖对应 manager/catalog 注入；生产 main runtime 会注入这些依赖，精简测试 server 可省略。

---

## 模块布局

```
src/
├── main/                        # Electron 主进程（仅这里允许 import 'electron'）
│   ├── index.ts                 # App 入口，BrowserWindow 创建
│   ├── app-lifecycle.ts         # ready/quit + Vite did-fail-load 重试
│   ├── preload.ts               # contextBridge → window.linkterm
│   └── ipc/
│       ├── index.ts             # 注册所有 IPC handlers + getActiveWindow 闭包
│       ├── session-ipc.ts       # session:write / transcript:subscribe 等
│       ├── session-create-handler.ts
│       ├── serial-ipc.ts        # 串口枚举
│       └── ui-bridge.ts         # ui:statePatch 单向广播
├── core/                        # 纯业务逻辑，零 Electron 依赖
│   ├── session/                 # ISession、SessionBase、SessionManager
│   ├── transcript/              # TranscriptBuffer + cursor
│   ├── write-queue/             # 单一序列化点（high/normal 双 lane）
│   ├── terminal-rules/          # CompletionDetector + EchoHandler + sendAndWait
│   └── workspace/               # WorkspaceConfigManager + Zod 严格校验
├── transports/                  # ITransport 适配器（工厂注入，便于测试）
│   ├── serial/                  # serialport
│   ├── ssh/                     # ssh2
│   └── local-shell/             # node-pty
├── mcp/
│   ├── server.ts、registry.ts、transport.ts、limits.ts
│   ├── versioning/
│   └── surfaces/{terminal,debug,ui,workspace,control-profile,control-workflow,rtt-log-session,...}/
├── jlink/                       # IJLinkBackend 调试/烧录/RTT/GDB 抽象 + 域错误 + NullJLinkBackend
├── renderer/                    # React + xterm.js + shadcn primitives
│   ├── components/              # ConnectionDialog / TerminalView / SessionTabBar / ...
│   ├── hooks/                   # useSession / useTranscript / useUiPatchSubscription
│   ├── store/                   # Zustand
│   ├── i18n/                    # zh / en
│   └── lib/                     # linkterm-bridge.ts 等
└── shared/                      # 跨进程类型 + IPC 通道名 + ERROR_CODES
```

`src/core/`、`src/jlink/`、`src/mcp/surfaces/` **必须**保持 Electron 无关，并使用相对 import + `.js` 后缀（ESM 要求）。`@/` 路径别名仅在 renderer 与测试中可用 —— 见下方「构建配置注意事项」。

---

## 快速开始

> 必须使用 `pnpm`（详见 `package.json` 的 `engines` 与 `packageManager`）。

```bash
pnpm install            # 安装依赖
pnpm run build          # 完整构建（tsc -b composite + vite build）
pnpm start              # 启动已构建的 Electron 应用
```

仅迭代 renderer 时：

```bash
pnpm run build:main     # 主进程必须先编译一次
pnpm run dev            # Vite dev server（main 仍需 build）
pnpm start              # 另起 Electron
```

注意 `pnpm run dev` 只启动 Vite；Electron 启动时若 Vite 还没就绪，`src/main/app-lifecycle.ts` 会以 500 ms × 20 次的 `did-fail-load` 重试兜底。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm run build` | 完整构建：`tsc -b`（composite 项目）+ `vite build` |
| `pnpm run build:main` | 仅构建主进程（`tsc -p tsconfig.main.json`） |
| `pnpm run build:renderer` | 仅构建 renderer |
| `pnpm run build:all` | 串行执行 main + renderer |
| `pnpm test` | 一次性跑全部 Vitest |
| `pnpm test -- path/to/file.test.ts` | 单文件 |
| `pnpm test -- -t "test name"` | 按名匹配 |
| `pnpm run test:watch` | watch 模式 |
| `pnpm run lint` | ESLint（`src/` + `tests/`） |
| `pnpm run format` | Prettier 格式化 |
| `pnpm run validate:licenses` | 双向校验 `third-party-manifest.json` ↔ `licenses/` ↔ `package.json` |
| `pnpm start` | 启动已构建的 Electron 应用 |
| `pnpm run dev` | Vite dev server（仅 renderer） |
| `pnpm run pack` | `electron-builder --dir`（不打安装包） |
| `pnpm run dist` | `electron-builder` 生成发布产物（按 `electron-builder.yml`） |

---

## 构建配置注意事项

- **ESM only**：`package.json` `"type": "module"`。主进程必须用 `import.meta.url` 派生 `__dirname`（`fileURLToPath(import.meta.url)`）。
- **主入口路径是 `dist/main/main/index.js`**（双 `main`），来自 TypeScript composite + `tsconfig.main.json` 的 `rootDir: src`。`package.json` 的 `main` 字段已设为该路径，请勿擅自改动。
- **`@/*` 别名是非对称的**：在 `tsconfig.json`、`vite.config.ts`、`vitest.config.ts` 中均配置为 `src/*`，但 `tsc` **不会**在 emit 时改写路径别名。规则：
  - Renderer 代码与测试可自由使用 `@/...`（Vite/Vitest 会改写）。
  - 主进程与 `src/core/`、`src/jlink/`、`src/mcp/` 代码必须用**相对 import**（`../shared/types.js`），且必须带 `.js` 后缀。
  - 全局把相对 import 替换成 `@/` 会过 `tsc -b`，但运行时 Node/Electron 抛 `ERR_MODULE_NOT_FOUND`。
- **`tsconfig.renderer.json` 的 `rootDir` 是 `src`**（不是 `src/renderer`），以便引入 `src/shared/`。
- **Tailwind v4** 使用 `@tailwindcss/postcss`（独立包），CSS 入口写 `@import 'tailwindcss';`。
- **CSP 通过 `session.defaultSession.webRequest.onHeadersReceived` 注入**，dev 与 prod 策略不同；不要在 `index.html` 里加 `<meta http-equiv="Content-Security-Policy">`，否则会阻断 Vite HMR。
- **TypeScript 严格模式**；ESLint 使用 flat config（`eslint.config.js`）+ `typescript-eslint`，启用 `no-unused-vars`（`argsIgnorePattern: ^_`）与 `no-explicit-any` 警告。

---

## 测试策略

- 框架：**Vitest**（不是 Jest）。配置见 `vitest.config.ts`。
- 默认 `environment: 'node'`；renderer 测试通过文件首行 `// @vitest-environment happy-dom` 切换。
- Setup：`tests/unit/setup.ts` + `tests/setup-renderer.ts`。
- Coverage 范围（v8 provider）：`src/core/**`、`src/transports/**`、`src/mcp/**`。
- 当前规模：**1024 用例 / 106 测试文件**。组织：

```
tests/
├── fixtures/        # mock-serialport / mock-ssh / mock-pty / fake-jlink-backend
├── integration/     # ai-human-coop / send-and-wait / serial-* / perf-* / high-impact-confirmation
└── unit/
    ├── core/        # session-manager / write-queue / transcript-buffer / terminal-rules / workspace
    ├── transports/  # serial / ssh / local-shell（transport 与 session 各自一份）
    ├── mcp/         # terminal-tools / debug / ui / workspace-tools / version-check
    ├── jlink/       # null-backend / jlink-adapter
    ├── main/ipc/    # session-create / ui-bridge
    ├── renderer/    # 组件 / hooks / store / lib（happy-dom）
    └── scripts/     # validate-licenses
```

**关键约束**：`src/core/` 的测试**必须**能在没有 Electron / 真实硬件 / SSH 服务器 / J-Link 探针的环境下运行（需求 §5.2）。Transport 适配器通过工厂依赖注入实现这一点 —— 见 `src/transports/serial/serial-port-like.ts` 的 `SerialPortFactory`、`src/transports/ssh/ssh-client-like.ts` 的 `SshClientFactory`、`src/transports/local-shell/pty-like.ts` 的 `PtyFactory`，测试用 `tests/fixtures/mock-{serialport,ssh,pty}.ts` 替换默认工厂。

---

## License 合规

每个**运行时**第三方依赖必须同时存在于：

1. `third-party-manifest.json` 的 `dependencies` 数组（含 `name` / `version` / `license` / `licenseFile`）
2. `licenses/<name>.LICENSE` 文件
3. `package.json` 的 `dependencies`（或 `EXTRA_RUNTIME_DEPS` 白名单）

`pnpm run validate:licenses`（脚本：`scripts/validate-licenses.ts`，纯函数 `validateLicenses({ manifestPath, packageJsonPath, rootDir })`）执行 4 项不变量校验：

1. **Manifest 内部一致性** —— 每条记录字段齐全且 license 文件实际存在；
2. **package.json → manifest** —— 每个 `dependencies` 键必须在 manifest 中有对应记录（或在 `EXTRA_RUNTIME_DEPS` 白名单中）；
3. **manifest → package.json** —— 每条 manifest 记录必须出现在 `dependencies` 或白名单中（删除依赖却忘删 manifest 会失败）；
4. **版本严格相等** —— `manifest.version === package.json.dependencies[name]`（字符串比较，无 semver 容忍）。

`EXTRA_RUNTIME_DEPS` 当前仅含 `electron`（位于 `devDependencies` 但会被 `electron-builder` 打入运行时产物）。脚本由 `tests/unit/scripts/validate-licenses.test.ts` 的 11 个用例守护。

当前已记录的 19 条运行时依赖：`@modelcontextprotocol/sdk`、`react`、`react-dom`、`zustand`、`electron`、`zod`、`serialport`、`ssh2`、`node-pty`、`@xterm/xterm`、`@xterm/addon-fit`、`@radix-ui/react-{dialog,tabs,select,label,slot}`、`class-variance-authority`、`clsx`、`tailwind-merge`。

> 第三方开源项目的设计可作参考，但源码复制需先做许可证审查与归因；`jlinkmcp`（https://github.com/daikw/JLinkMCP）无声明 license，仅作设计参考、不复制源码（需求 §4.11）。

---

## 贡献指南（维护者要点）

- **修改前先读 `DEVELOPMENT_PLAN.md`**：每个 Phase 的状态徽章（已完成 / 进行中 / 未开始）与「变更记录」子节是跨会话的事实来源；任何偏离原计划的决策都要写回该文件。
- **新增运行时依赖** = 同一次提交里同时更新 `package.json`、`third-party-manifest.json`、`licenses/<name>.LICENSE`，并跑通 `pnpm run validate:licenses`。
- **新增错误码（M5 双向同步模式）**：必须**同时**加入
  - `src/shared/error-codes.ts` 的 `ERROR_CODES` 常量；
  - `src/mcp/registry.ts` 的 `ToolErrorCode` 联合类型。
  现有翻译层基于 `instanceof` 的错误链（见 `src/mcp/surfaces/debug/error-translate.ts`、`src/mcp/surfaces/workspace/tools.ts`），缺失任一半会让翻译静默退化。
- **新增高敏感 J-Link 工具**：在 schema 加 `confirm: confirmField`，在 `runJLink(...)` 内的第一句 `if (input.confirm !== true) throw new ConfirmationRequiredError(toolName)`，并在 `description` 里追加「High-impact: requires confirm=true; otherwise CONFIRMATION_REQUIRED is returned.」。
- **不得让 MCP 工具或 IPC handler 直接触碰 transport** —— 一切写入必须经 `SessionManager.write`。这是硬安全边界。
- **不要在 `src/core/` 引入 `electron`、`serialport`、`ssh2`、`node-pty`**；只能通过 `*-{port,client}-like.ts` 接口与默认工厂消费。
- **不要把 SSH 凭据放进 `SshSessionConfig` 持久结构** —— `credentials` 是 `session:create` IPC 的独立顶层字段，`buildSession()` 在 `await` 之前就会清空它。
- **每个 phase 收尾时**：更新 `DEVELOPMENT_PLAN.md` 进度、补 JSDoc、确保 ESLint 与 Vitest 全绿。

---

## 关键参考文档

- [`PROJECT_REQUIREMENTS.md`](./docs/PROJECT_REQUIREMENTS.md) — 权威需求规格
- [`DEVELOPMENT_PLAN.md`](./docs/DEVELOPMENT_PLAN.md) — 13 阶段计划与历史决策
- [`CLAUDE.md`](./CLAUDE.md) — 给代码助手的工程边界与不变量摘要
- [`docs/phase-decisions/`](./docs/phase-decisions/) — Phase 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 的 review 记录
