# LinkTerm Electron v2 开发计划

## Context

LinkTerm v2 需要用 Electron/TypeScript 重写，替代旧 Qt/C++ 实现，形成单一运行时的桌面终端 + MCP 自动化平台。当前项目为完全绿地状态，仅有 `PROJECT_REQUIREMENTS.md`。本计划将需求拆分为 13 个可交付、可测试的阶段，按依赖顺序推进。

---

## 阶段进度总览

| 阶段 | 状态 | 完成日期 |
|---|---|---|
| Phase 0: 项目脚手架 | ✅ 已完成 | 2026-06-13 |
| Phase 1: 核心会话+Transcript+WriteQueue | ✅ 已完成 | 2026-06-13 |
| Phase 2: 串口适配器 | ⬜ 未开始 | — |
| Phase 3: SSH+本地 Shell | ⬜ 未开始 | — |
| Phase 4: MCP 终端工具 | ⬜ 未开始 | — |
| Phase 5: AI-人共同操作 | ⬜ 未开始 | — |
| Phase 6: Electron UI | ⬜ 未开始 | — |
| Phase 7: 终端规则+sendAndWait | ⬜ 未开始 | — |
| Phase 8: 工作区配置 | ⬜ 未开始 | — |
| Phase 9: J-Link MCP | ⬜ 未开始 | — |
| Phase 10: UI MCP 工具 | ⬜ 未开始 | — |
| Phase 11: 许可证管理 | 🟨 部分完成（Phase 0 已建立基础） | — |
| Phase 12: 集成+收尾 | ⬜ 未开始 | — |

---

## 架构总览

### 进程模型

- **Main Process** — 拥有所有状态资源：SessionManager、TranscriptBuffer、WriteQueue、Transport 适配器、MCP Server、工作区配置、J-Link backend 抽象
- **Renderer Process** — 薄 UI 壳：React 组件承载 xterm.js、连接对话框、i18n、IPC 绑定
- **MCP Server** — 运行在 Main Process 内（或 fork 子进程），共享 SessionManager 实例，通过 stdio/本地 TCP 与外部 MCP Host 通信
- **IPC Bridge** — Request/response 用 `ipcRenderer.invoke` / `ipcMain.handle`；流式终端数据用事件推送

### 核心抽象关系

```
MCP Server ──> MCP Tool Handlers ──> SessionManager
                                         │
                              ┌──────────┴──────────┐
                         WriteQueue           TranscriptBuffer
                      (有序、标记来源)         (cursor、origin)
                              │                     │
                        ITransport impl        Event subscribers
                     (serial|ssh|shell)
```

所有写入必须经过 WriteQueue 单一瓶颈，保证 AI/人操作顺序一致、可审计。

---

## 工具选型

| 类别 | 选择 | 理由 |
|---|---|---|
| 包管理器 | `pnpm` | 快、磁盘省、严格依赖解析 |
| 构建工具 | `Vite`（渲染进程）+ `tsc`（主进程） | 渲染进程 HMR 快；主进程 TypeScript 直编 |
| UI 框架 | `React 19` | xterm.js 生态绑定好，hooks 适配 session/transcript 订阅 |
| 状态管理 | `Zustand` | 轻量无模板代码，适合 IPC→state 桥接 |
| CSS 方案 | `Tailwind CSS` | 工具类快速开发，不写自定义 CSS 框架 |
| 测试框架 | `Vitest` | 与 Vite 共享配置，ESM 原生，快 |
| Schema/校验 | `Zod` | MCP 工具参数校验 + 工作区配置校验统一 |
| Lint/格式化 | `ESLint` + `typescript-eslint` + `Prettier` | 标准组合 |
| 终端渲染 | `@xterm/xterm` + `addon-fit` + `addon-web-links` | 需求指定 |
| 串口 | `serialport` | 需求指定 |
| SSH | `ssh2` | 需求指定 |
| 本地 Shell | `node-pty` | PTY 模拟完整，支持 resize |
| MCP 协议 | `@modelcontextprotocol/sdk` | 需求指定 |
| Electron 打包 | `electron-builder` | 成熟，多平台支持 |
| ID 生成 | `crypto.randomUUID()` | Node.js 内置，无需额外依赖 |

### 不选的及理由

| 排除项 | 理由 |
|---|---|
| `webpack` | 配置重，HPR 慢，Vite 已满足需求 |
| `Vue` / `Svelte` | xterm.js React 生态更成熟，社区示例和组件更多 |
| `Redux` | 模板代码多，本应用状态不复杂，Zustand 足够 |
| `uuid` 库 | Node 19+ 内置 `crypto.randomUUID()`，无需额外依赖 |
| `electron-forge` | electron-builder 生态更广，多平台打包方案更成熟 |

---

## 目录结构

```
link-terminal-demo/
├── src/
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # App 入口，BrowserWindow 创建
│   │   ├── app-lifecycle.ts           # App ready/quit 处理
│   │   └── ipc/
│   │       ├── index.ts               # 注册所有 IPC handlers
│   │       ├── session-ipc.ts         # 会话操作 IPC
│   │       ├── serial-ipc.ts          # 串口发现 IPC
│   │       └── ui-ipc.ts              # 截图/配置控制 IPC
│   ├── core/                          # 纯业务逻辑，零 Electron 依赖
│   │   ├── session/
│   │   │   ├── types.ts               # ISession, SessionConfig, SessionType, SerialMode
│   │   │   ├── session-base.ts        # 抽象基类
│   │   │   ├── session-manager.ts     # 会话注册、生命周期、路由
│   │   │   └── index.ts
│   │   ├── transcript/
│   │   │   ├── types.ts               # Origin, EventType, SequenceCursor, TranscriptEvent
│   │   │   ├── transcript-buffer.ts   # 追加写入 buffer，cursor 读取
│   │   │   └── index.ts
│   │   ├── write-queue/
│   │   │   ├── write-queue.ts         # 有序队列，来源标记，审计日志
│   │   │   └── index.ts
│   │   ├── terminal-rules/
│   │   │   ├── types.ts               # TerminalRuleSet, CompletionMarker, SendAndWaitResult
│   │   │   ├── rules.ts               # 统一嵌入式终端规则
│   │   │   ├── completion-detector.ts # 跨 chunk 完成标记检测 FSM
│   │   │   ├── echo-handler.ts        # 回显剥离
│   │   │   ├── send-and-wait.ts       # sendAndWait 编排
│   │   │   └── index.ts
│   │   └── workspace/
│   │       ├── types.ts               # WorkspaceConfig, ChipConfig 等
│   │       ├── config-schema.ts       # Zod schema
│   │       ├── workspace-config.ts    # 读写/校验工作区配置
│   │       └── index.ts
│   ├── transports/                    # Transport 适配器
│   │   ├── types.ts                   # ITransport 接口
│   │   ├── serial/
│   │   │   ├── serial-transport.ts
│   │   │   ├── serial-discovery.ts
│   │   │   ├── serial-session.ts
│   │   │   └── index.ts
│   │   ├── ssh/
│   │   │   ├── ssh-transport.ts
│   │   │   ├── ssh-session.ts
│   │   │   └── index.ts
│   │   └── local-shell/
│   │       ├── local-shell-transport.ts
│   │       ├── local-shell-session.ts
│   │       └── index.ts
│   ├── mcp/                           # MCP server 和工具 surface
│   │   ├── server.ts                  # MCP server 创建和启动
│   │   ├── transport.ts               # Stdio / 本地 TCP transport
│   │   ├── versioning/
│   │   │   ├── version-check.ts       # Schema 版本检查
│   │   │   └── index.ts
│   │   └── surfaces/
│   │       ├── terminal/
│   │       │   ├── tools.ts           # list_sessions, open_session 等
│   │       │   ├── schemas.ts         # Zod 输入/输出 schema
│   │       │   └── index.ts
│   │       ├── debug/
│   │       │   ├── tools.ts           # probe_*, cpu_*, flash_*, rtt_*, gdb_*
│   │       │   ├── schemas.ts
│   │       │   ├── debug-backend.ts   # IDebugBackend 接口
│   │       │   └── index.ts
│   │       └── ui/
│   │           ├── tools.ts           # ui_configure, ui_screenshot
│   │           ├── schemas.ts
│   │           └── index.ts
│   ├── jlink/                         # J-Link backend 抽象
│   │   ├── types.ts                   # IJLinkBackend, DebugResult 等
│   │   ├── null-backend.ts            # 无 backend 时安全拒绝
│   │   ├── jlink-adapter.ts           # 具体适配器（需 J-Link 软件）
│   │   └── index.ts
│   ├── renderer/                      # Electron 渲染进程 (React)
│   │   ├── index.html
│   │   ├── index.tsx                  # React 挂载
│   │   ├── App.tsx                    # 根组件
│   │   ├── components/
│   │   │   ├── TerminalView.tsx       # xterm.js 封装
│   │   │   ├── ConnectionDialog.tsx   # 新连接表单
│   │   │   ├── SessionTabBar.tsx      # 会话标签栏
│   │   │   ├── SerialPortPicker.tsx   # 串口选择器
│   │   │   └── OriginIndicator.tsx    # 来源指示器
│   │   ├── hooks/
│   │   │   ├── useSession.ts
│   │   │   ├── useTranscript.ts
│   │   │   └── useSerialDiscovery.ts
│   │   ├── i18n/
│   │   │   ├── en.ts
│   │   │   ├── zh.ts
│   │   │   └── index.ts
│   │   └── styles/
│   │       └── global.css
│   └── shared/                        # 跨进程共享类型
│       ├── types.ts
│       ├── constants.ts
│       └── ipc-protocol.ts
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   ├── transports/
│   │   ├── mcp/
│   │   └── jlink/
│   ├── integration/
│   └── fixtures/
│       ├── mock-transport.ts
│       ├── mock-serialport.ts
│       ├── mock-ssh2.ts
│       └── mock-jlink-backend.ts
├── scripts/
│   └── validate-licenses.ts
├── licenses/
├── third-party-manifest.json
├── package.json
├── tsconfig.json / tsconfig.main.json / tsconfig.renderer.json
├── vite.config.ts
├── electron-builder.yml
└── PROJECT_REQUIREMENTS.md
```

---

## Phase 0: 项目脚手架 ✅ 已完成（2026-06-13）

**目标**：建立构建工具链、项目结构和 Electron 引导，使后续阶段有可用的编译/运行/测试循环。

### 实际交付物

| 文件/模块 | 状态 | 说明 |
|---|---|---|
| `package.json` | ✅ | `"type": "module"`、pnpm@9.15.0、所有脚本 |
| `tsconfig.json` + 项目引用 | ✅ | composite 项目，main + renderer 引用 |
| `tsconfig.main.json` | ✅ | 主进程编译配置 |
| `tsconfig.renderer.json` | ✅ | **rootDir 设为 `src`（非 `src/renderer`），以便 include `src/shared`** |
| `vite.config.ts` | ✅ | 渲染进程 Vite 配置 |
| `electron-builder.yml` | ✅ | mac/win/linux 多平台打包配置 |
| `eslint.config.js` | ✅ | flat config + typescript-eslint，支持 JSX/TS 解析 |
| `.prettierrc` | ✅ | semi、singleQuote、printWidth 100 |
| `postcss.config.js` | ✅ | **使用 `@tailwindcss/postcss`（Tailwind v4 已分包）** |
| `src/main/index.ts` | ✅ | Electron 主入口 |
| `src/main/app-lifecycle.ts` | ✅ | createMainWindow、ESM 兼容 `__dirname` |
| `src/main/ipc/index.ts` | ✅ | IPC handler 注册占位（Phase 5 填充） |
| `src/renderer/index.html` | ✅ | 最小 HTML |
| `src/renderer/index.tsx` | ✅ | React 19 挂载 |
| `src/renderer/App.tsx` | ✅ | **丰富占位 UI：LinkTerm v2 logo、版本号、串口/SSH/本地 Shell 卡片** |
| `src/renderer/styles/global.css` | ✅ | Tailwind v4 `@import 'tailwindcss'` |
| `src/renderer/vite-env.d.ts` | ✅ | CSS 模块类型声明 |
| `src/shared/types.ts` | ✅ | 占位类型（Phase 1 扩展） |
| `src/shared/constants.ts` | ✅ | APP_NAME 等常量 |
| `src/shared/ipc-protocol.ts` | ✅ | IPC channel 名称 |
| `src/shared/index.ts` | ✅ | 桶导出 |
| `vitest.config.ts` | ✅ | 测试运行器配置 |
| `tests/unit/setup.ts` | ✅ | 全局设置（占位） |
| `tests/unit/smoke.test.ts` | ✅ | 3 个冒烟测试（APP_NAME、IPC channels、shared types） |
| `third-party-manifest.json` | ✅ | 5 个核心运行时依赖 |
| `licenses/` | ✅ | react/react-dom/zustand/electron/zod 许可证文件 |
| `scripts/validate-licenses.ts` | ✅ | 双向校验脚本 |
| `.gitignore` | ✅ | node_modules/dist/release |

### Phase 0 实施期间的需求/决策变更

| 变更项 | 原计划 | 实际 | 原因 |
|---|---|---|---|
| `i18n/` 目录 | 在脚手架阶段创建占位 | **已删除** | 用户决定 Phase 6 构建 UI 时再引入 |
| 组件库 | 未指定 | **暂不引入；Phase 6 构建 UI 时再考虑 shadcn/ui** | 用户决定延后 |
| 包管理器 | pnpm（"验收标准"行写的是 `npm install`） | **统一使用 pnpm** | 用户确认 |
| Tailwind 集成 | `tailwindcss` 直接作为 PostCSS 插件 | **改用 `@tailwindcss/postcss`** | Tailwind v4 PostCSS 插件已独立分包 |
| 主进程模块 | 未指定 ESM/CJS | **使用 ESM（`"type": "module"`）** | 与 Vite/Vitest 一致；`__dirname` 通过 `import.meta.url` 派生 |
| 主入口路径 | `dist/main/index.js` | **`dist/main/main/index.js`** | composite + rootDir=src 的输出嵌套副作用 |
| TypeScript 版本 | 未指定 | **^6.0.3** | 实际安装版本 |
| Electron 版本 | 未指定 | **^42.4.0** | 最新稳定版 |
| React 版本 | 19 | **^19.2.7** | 实际安装版本 |

### 实际依赖

**运行时**：`react` ^19.2.7, `react-dom` ^19.2.7, `zustand` ^5.0.14

**开发**：`@tailwindcss/postcss` ^4.3.1, `@types/node` ^25.9.3, `@types/react` ^19.2.17, `@types/react-dom` ^19.2.3, `@vitejs/plugin-react` ^6.0.2, `autoprefixer` ^10.5.0, `electron` ^42.4.0, `electron-builder` ^26.15.3, `eslint` ^9.39.4, `postcss` ^8.5.15, `prettier` ^3.8.4, `tailwindcss` ^4.3.1, `tsx` ^4.22.4, `typescript` ^6.0.3, `typescript-eslint` ^8.61.0, `vite` ^8.0.16, `vitest` ^4.1.8, `zod` ^4.4.3

### 验收标准（全部通过）

- ✅ `pnpm install && pnpm run build && pnpm test` 在干净环境通过
- ✅ TypeScript strict 模式启用并通过
- ✅ 3 个冒烟测试通过
- ✅ `pnpm run validate:licenses` 通过（5/5 依赖）
- ✅ ESLint 配置可解析 TS/JSX
- ✅ 项目目录结构对齐计划

### 相对工作量：1x

---

## Phase 0（原始）：项目脚手架

> 以下为原始计划文本，保留作为历史参考。实际交付以上方"已完成"小节为准。

**目标**：建立构建工具链、项目结构和 Electron 引导，使后续阶段有可用的编译/运行/测试循环。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `package.json` | 依赖、脚本（build/test/start/validate:licenses） |
| `tsconfig.json` + 项目引用 | TypeScript 配置 |
| `vite.config.ts` | 渲染进程打包 |
| `electron-builder.yml` | Electron 打包配置 |
| `.eslintrc.cjs`, `.prettierrc` | 代码风格 |
| `src/main/index.ts` | Electron 主入口：创建 BrowserWindow |
| `src/main/app-lifecycle.ts` | App ready/quit 处理 |
| `src/renderer/index.html` | 最小 HTML |
| `src/renderer/index.tsx` | React 挂载（渲染 "LinkTerm v2"） |
| `src/renderer/App.tsx` | 根组件占位 |
| `vitest.config.ts` | 测试运行器配置 |
| `tests/unit/setup.ts` | 测试全局设置 |
| `third-party-manifest.json` | 初始依赖清单 |
| `licenses/` | 初始依赖许可证文件 |

### npm 依赖

- 运行时：`electron`, `react`, `react-dom`, `zustand`
- 开发：`typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `electron-builder`, `eslint`, `typescript-eslint`, `prettier`, `tailwindcss`, `@types/react`, `@types/react-dom`

### 验收标准

- `npm install && npm run build && npm test` 在干净环境通过
- Electron 窗口打开显示占位 UI
- TypeScript strict 模式启用并通过
- 单个冒烟测试通过

### 相对工作量：1x

---

## Phase 1: 核心会话抽象 + TranscriptBuffer + WriteQueue ✅ 已完成（2026-06-13）

**目标**：构建所有后续阶段依赖的基础类型和类。这是最重要的阶段。

### 实际交付物

| 文件/模块 | 状态 | 说明 |
|---|---|---|
| `src/shared/types.ts` 扩展 | ✅ | 新增 `SessionState` 联合类型（idle/opening/open/closing/closed/errored） |
| `src/shared/constants.ts` 扩展 | ✅ | 新增 `MAX_EVENT_DATA_BYTES`；`MAX_TRANSCRIPT_EVENTS` 注释更新 |
| `src/transports/types.ts` | ✅ | `ITransport` 接口（EventEmitter + Promise 风格）+ `TransportEvents` |
| `src/transports/index.ts` | ✅ | 桶导出 |
| `src/core/transcript/types.ts` | ✅ | `EventType`（不含 truncated 哨兵）/`SequenceCursor=number`/`TranscriptEvent`/`ITranscriptBuffer` |
| `src/core/transcript/transcript-buffer.ts` | ✅ | 环形缓冲实现，sequence 单调递增；溢出通过 `ReadResult.truncated` 标志暴露 |
| `src/core/transcript/index.ts` | ✅ | 桶导出 |
| `src/core/write-queue/types.ts` | ✅ | `IWriteQueue`/`WriteQueueItem`/`WriteAuditCallback` |
| `src/core/write-queue/write-queue.ts` | ✅ | Promise 链 FIFO 串行；单 item 失败不卡死后续；close() drain |
| `src/core/write-queue/index.ts` | ✅ | 桶导出 |
| `src/core/session/types.ts` | ✅ | `ISession`/`SessionWriteOptions`/`SessionErrorMeta`/`SessionStateMeta` |
| `src/core/session/session-base.ts` | ✅ | 抽象基类，串联 transport↔TranscriptBuffer↔WriteQueue；error/close 路径自动释放资源 |
| `src/core/session/session-manager.ts` | ✅ | 注册/查找/销毁/事件转发；`crypto.randomUUID()` 生成 ID |
| `src/core/session/index.ts` | ✅ | 桶导出 |
| `src/core/index.ts` | ✅ | core 桶导出 |
| `tests/fixtures/mock-transport.ts` | ✅ | 完整 ITransport mock，支持 failOnOpen/writeBehavior/pushIncoming/pushError/triggerClose |
| `tests/unit/core/transcript-buffer.test.ts` | ✅ | 11 个测试覆盖 cursor 边界/环形溢出/多 reader |
| `tests/unit/core/write-queue.test.ts` | ✅ | 10 个测试覆盖 FIFO/串行/失败传播/close drain/AI+人交替 |
| `tests/unit/core/session-manager.test.ts` | ✅ | 19 个测试覆盖状态机/资源释放/transport 错误链路 |

### 关键架构决策

1. **TranscriptBuffer 追加写入 + 单调递增 sequence** — clear/error/state 都作为事件追加，不删除历史
2. **环形缓冲溢出通过 ReadResult.truncated 标志暴露**（不在 buffer 内插入哨兵事件，避免"双倍丢弃"）
3. **WriteQueue 是所有会话写入的单一瓶颈**，FIFO 串行；origin 是 §4.5 审计不变量的载体
4. **SequenceCursor 形态：每会话独立的 number**（最易测、最易序列化、最易调试）
5. **core 层零 Electron 依赖** — 仅依赖 `node:events` 与 `node:crypto`
6. **transport 错误/主动 close 时自动释放队列与底层连接**（fire-and-forget），避免句柄泄漏

### Phase 1 实施期间的需求/决策变更

| 变更项 | 原计划 | 实际 | 原因 |
|---|---|---|---|
| Buffer 容量策略 | 未明示 | **环形缓冲 + 软上限**：满时丢最旧，readSince 通过 truncated 标志暴露 | 用户确认：内存可预测、Phase 5 再做压缩 |
| Cursor 形态 | 未明示 | **每会话独立的 number**，从 1 起分配，0 表示"未读取过" | 用户确认：最易测试与调试 |
| 并发写入模型 | 未明示 | **FIFO + per-session 串行**，origin 仅作审计标签（不做优先级） | 用户确认；Phase 5 再加优先级/背压 |
| ITransport 风格 | 未明示 | **EventEmitter + Promise**（'data'/'error'/'close' 事件 + open/close/write Promise） | 用户确认：与 serialport/ssh2/node-pty 生态对齐 |
| 错误传递 | 未明示 | transport 'error' → transcript 记录 EventType.error + state='errored' + **fire-and-forget 释放底层** | 用户确认 + 审查发现：errored 后必须自动 close 句柄 |
| `EventType` 含 'truncated' | 计划 v1 草稿曾出现 | **已删除**，与实现保持一致 | 审查发现合同与实现互相矛盾，统一为"标志暴露" |
| `SessionDeps`/`SessionEventEmitter`/`writeQueueFactory` | 临时引入 | **已删除** | 审查发现是死代码，且 writeQueueFactory 会绕过 audit 破坏审计不变量 |

### 验收标准（全部通过）

- ✅ `pnpm test`：46 个测试通过，324ms（远低于 5 秒上限）
- ✅ `pnpm run lint`：0 错误 0 警告
- ✅ `pnpm run build`：main + renderer 双侧 tsc strict 编译通过
- ✅ `pnpm run validate:licenses`：5/5 依赖许可证完整
- ✅ `src/core/` 零 Electron 依赖（grep 确认）
- ✅ 测试不依赖硬件、串口、SSH、Electron
- ✅ TranscriptBuffer 支持多 cursor 并发读取
- ✅ WriteQueue 单 item 失败不阻塞后续；close() 真 drain
- ✅ SessionBase 在 error/close 路径自动释放队列与 transport（避免 Phase 2 真适配器场景下的句柄泄漏）

### 相对工作量：3x

---

## Phase 1（原始）：核心会话抽象 + TranscriptBuffer + WriteQueue

> 以下为原始计划文本，保留作为历史参考。实际交付以上方"已完成"小节为准。

**目标**：构建所有后续阶段依赖的基础类型和类。这是最重要的阶段。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/shared/types.ts` | SessionId, ConnectionType, SerialMode, Origin, EvidenceKind |
| `src/shared/constants.ts` | 默认超时、buffer 大小限制、完成标记 |
| `src/shared/ipc-protocol.ts` | IPC channel 名称和消息类型 |
| `src/core/transcript/types.ts` | TranscriptEvent, EventType, SequenceCursor |
| `src/core/transcript/transcript-buffer.ts` | 追加写入 buffer：append(), readFrom(cursor), readSince(cursor), clear 保留审计 |
| `src/core/write-queue/write-queue.ts` | 有序队列：enqueue(origin, data)，串行处理，标记来源 |
| `src/core/session/types.ts` | ISession 接口，SessionConfig（按类型区分联合） |
| `src/core/session/session-base.ts` | 抽象基类：委托 WriteQueue，追加 TranscriptBuffer |
| `src/core/session/session-manager.ts` | create/destroy/list/get/write/read/waitFor |
| `tests/fixtures/mock-transport.ts` | ITransport mock |

### 关键架构决策

1. **TranscriptBuffer 追加写入 + 单调递增序列号** — clear 事件记录在 buffer 中，不删除历史事件；MCP 用 cursor 向前读取
2. **WriteQueue 是所有会话写入的单一瓶颈** — AI(MCP) 和人(UI IPC) 的写入都通过 SessionManager.write → WriteQueue，保证顺序和审计
3. **ISession 是接口而非类层次** — 各 Transport session 组合 transport 实例
4. **core 层零 Electron 依赖** — 纯 TypeScript，使用 ITransport 接口和 EventEmitter

### 测试交付

- `transcript-buffer.test.ts` — 追加/读取/cursor/清除保留历史/多 cursor/大小限制
- `write-queue.test.ts` — 串行排序/来源标记/AI+人交替/队列排空
- `session-manager.test.ts` — 创建/销毁/写入/读取/状态转换/错误处理

### 验收标准

- 全部测试不依赖硬件、串口、SSH、Electron 即可通过
- TranscriptBuffer 支持至少 10 个独立 cursor 并发读取
- WriteQueue 保证写入按入队顺序处理
- `npm test` 5 秒内完成

### 新增依赖：`zod`（会话 ID 使用内置 `crypto.randomUUID()`，无需 uuid 库）

### 相对工作量：3x

---

## Phase 2: 串口适配器 ⬜ 未开始

**目标**：实现第一个真实 transport，证明会话抽象端到端可用。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/transports/types.ts` | ITransport 接口 |
| `src/transports/serial/serial-transport.ts` | 串口 transport |
| `src/transports/serial/serial-discovery.ts` | 端口枚举 listPorts()/watchPorts() |
| `src/transports/serial/serial-session.ts` | SerialSession：普通模式 + 终端模式 |
| `src/main/ipc/serial-ipc.ts` | 端口发现 IPC |
| `tests/fixtures/mock-serialport.ts` | Mock SerialPort |

### 关键架构决策

1. **串口模式在创建时指定，不可变** — normal 模式原始 I/O，terminal 模式启用规则和 sendAndWait
2. **SerialDiscovery 与 SerialTransport 分离** — 枚举是独立关注点，UI 和 MCP 都可调用
3. **普通模式保留原始字节证据** — TranscriptBuffer 记录每字节 EvidenceKind.raw_bytes

### 测试交付

- `serial-transport.test.ts` — 打开/关闭/写入/数据转发/错误传播
- `serial-discovery.test.ts` — 端口枚举/变更事件
- `serial-session.test.ts` — 普通/终端模式 I/O，模式可见性

### 新增依赖：`serialport`

### 依赖阶段：Phase 1

### 相对工作量：2x

---

## Phase 3: SSH + 本地 Shell 适配器 ⬜ 未开始

**目标**：完成所有三种会话类型，共享同一会话契约。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/transports/ssh/ssh-transport.ts` | SSH transport |
| `src/transports/ssh/ssh-session.ts` | SSH session |
| `src/transports/local-shell/local-shell-transport.ts` | 本地 Shell transport (node-pty) |
| `src/transports/local-shell/local-shell-session.ts` | 本地 Shell session |
| `tests/unit/transports/session-contract.test.ts` | 参数化契约测试 |
| `tests/fixtures/mock-ssh2.ts`, `mock-pty.ts` | Mock |

### 关键架构决策

1. **会话契约测试** — 单一参数化测试套件验证三种 session 都满足 ISession 契约
2. **SSH 配置排除敏感数据** — 不持久化密码/私钥；TranscriptBuffer 从不记录凭证
3. **本地 Shell 用 node-pty** — 提供完整 PTY 模拟（含 resize 信号）

### 测试交付

- `ssh-transport.test.ts` — 连接/数据流/断连
- `local-shell-transport.test.ts` — spawn/数据/resize/退出
- `session-contract.test.ts` — 三种类型参数化：create/write/read/waitFor/clear/resize/status/close

### 新增依赖：`ssh2`, `node-pty`

### 依赖阶段：Phase 1, Phase 2

### 相对工作量：1.5x

---

## Phase 4: MCP 终端工具 ⬜ 未开始

**目标**：通过 MCP 协议将会话操作暴露给 AI。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/mcp/server.ts` | MCP server 创建和启动 |
| `src/mcp/transport.ts` | Stdio + 本地 TCP transport |
| `src/mcp/versioning/version-check.ts` | Schema 版本检查，不匹配安全拒绝 |
| `src/mcp/surfaces/terminal/tools.ts` | 工具实现 |
| `src/mcp/surfaces/terminal/schemas.ts` | Zod schema |

### MCP 终端工具清单

| 工具 | 用途 |
|---|---|
| `list_sessions` | 列出所有活跃会话 |
| `open_session` | 创建会话 |
| `close_session` | 销毁会话 |
| `write_to_session` | 写入数据（origin=ai） |
| `read_from_session` | 从 cursor 读取 transcript |
| `send_and_wait` | 写入并等待完成（基础版：等待任意输出或超时） |
| `discover_serial_ports` | 列出可用串口 |
| `get_session_status` | 获取会话状态 |

### 结构化结果格式

每个工具返回：`{ success, sessionId?, state?, evidence: { kind, data, cursor }, error?, correlationId, origin: 'ai' }`

### 关键架构决策

1. **MCP 工具不直接接触 transport** — 全部通过 SessionManager，硬安全边界
2. **Schema 版本在 server 启动时声明** — 版本不匹配拒绝危险操作
3. **本阶段 sendAndWait 为基础版** — 跨 chunk 完成检测在 Phase 7 增强

### 测试交付

- `terminal-tools.test.ts` — 每个工具 + mock SessionManager，验证结构化结果
- `version-check.test.ts` — 版本匹配/不匹配安全拒绝
- `mcp-session-roundtrip.test.ts` — 集成：MCP open→write→read 完整回路

### 新增依赖：`@modelcontextprotocol/sdk`

### 依赖阶段：Phase 1-3

### 相对工作量：2.5x

---

## Phase 5: AI 与人共同操作加固 ⬜ 未开始

**目标**：验证和加固 AI-人共享会话模型，处理并发访问、cursor 一致性、清屏审计保留、多客户端协调。

### 交付物

- `write-queue.ts` 增强 — 优先级感知排序、correlationId、背压
- `transcript-buffer.ts` 增强 — 清屏事件 cursor 边界、新 reader 快照、大 buffer 压缩
- `session-ipc.ts` — 人类写入通过 SessionManager(origin=human)，transcript 订阅推送到渲染进程
- `session-manager.ts` 增强 — 多客户端 cursor 追踪、并发 waitFor 协调

### 关键验证场景

1. 人写入 → AI 通过 MCP 可见
2. AI 写入 → 人在 UI 实时可见
3. AI+人几乎同时写入 → WriteQueue 产出单一有序序列
4. 人清屏 → MCP 收到 clear 事件和新 cursor 边界，历史不丢失
5. 多 MCP 客户端并发读取 → 独立 cursor，不丢事件
6. MCP 客户端使用过期 cursor → 返回清屏事件和有效 cursor 范围

### 测试交付

- `ai-human-coop.test.ts` — 以上 6 个场景
- `write-queue.test.ts` 扩展 — 并发入队、背压
- `transcript-buffer.test.ts` 扩展 — 清屏 cursor 边界、大 buffer 压缩

### 依赖阶段：Phase 1, Phase 4

### 相对工作量：2x

---

## Phase 6: Electron UI ⬜ 未开始

**目标**：构建 xterm.js 终端渲染 UI、连接对话框、串口发现和中英文支持。

> **变更记录**：用户决定在此阶段考虑引入 `shadcn/ui` 组件库（基于 Tailwind v4 + Radix UI）。i18n 目录在 Phase 0 已删除，将在此阶段重新创建。

### 交付物

| 组件 | 用途 |
|---|---|
| `TerminalView.tsx` | xterm.js 封装，订阅 transcript，渲染数据 |
| `ConnectionDialog.tsx` | 新连接表单，按类型显示对应字段 |
| `SessionTabBar.tsx` | 多会话标签栏 |
| `SerialPortPicker.tsx` | 自动扫描 + 手动输入 + 刷新 |
| `OriginIndicator.tsx` | 来源视觉指示器 |
| `useSession.ts`, `useTranscript.ts`, `useSerialDiscovery.ts` | React hooks |
| `i18n/en.ts`, `i18n/zh.ts` | 中英文本地化 |

### 关键架构决策

1. **xterm.js 订阅 TranscriptBuffer** — 渲染与 MCP 相同的统一流
2. **连接表单按类型区分** — 串口显示波特率/模式；SSH 显示主机/端口/认证；本地 Shell 显示路径
3. **串口自动扫描 on mount** — 空列表显示手动输入
4. **人输入走 IPC + origin=human** — 所有写入经 WriteQueue

### 新增依赖：`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`

### 依赖阶段：Phase 1-5

### 相对工作量：2.5x

---

## Phase 7: 嵌入式终端规则 + 增强 sendAndWait ⬜ 未开始

**目标**：实现统一嵌入式终端交互规则和跨 chunk 完成标记检测。**技术风险最高阶段。**

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/core/terminal-rules/types.ts` | TerminalRuleSet, CompletionMarker, SendAndWaitResult |
| `src/core/terminal-rules/rules.ts` | 统一规则：行尾(\r\n)、完成标记、回显处理、默认超时 |
| `src/core/terminal-rules/completion-detector.ts` | **FSM 跨 chunk 完成标记检测器** |
| `src/core/terminal-rules/echo-handler.ts` | 回显行检测和剥离 |
| `src/core/terminal-rules/send-and-wait.ts` | 编排：写入→缓冲→检测完成或超时→返回结构化结果 |
| `serial-session.ts` 增强 | 终端模式使用 sendAndWait + 终端规则 |
| `terminal/tools.ts` 增强 | send_and_wait 工具使用 TerminalRules |

### 关键架构决策

1. **CompletionDetector 是有状态 FSM** — 逐 chunk 接收，维护部分匹配缓冲，正确处理跨 chunk 的完成标记
2. **统一规则适用所有设备** — 不按设备类型拆分配置
3. **超时返回结构化信息，不切换模式** — success:false, reason:'timeout'，包含已收到的输出和 cursor
4. **终端规则仅在 terminal mode 生效**

### 测试交付（重点）

- `terminal-rules.test.ts` — 行尾、超时值、回显行为
- **`completion-detector.test.ts`** — 单 chunk 匹配、跨 2/3/5 chunk 匹配、部分匹配后重置、多标记、空 chunk 间隔、Unicode 标记
- `echo-handler.test.ts` — 精确回显剥离、非回显透传
- `send-and-wait.test.ts` — 成功完成、超时+部分输出、跨 chunk 完成
- `integration/send-and-wait.test.ts` — 完整集成，mock transport 模拟分片输出

### 依赖阶段：Phase 1, Phase 2, Phase 4

### 相对工作量：3x（最高风险）

---

## Phase 8: 工作区配置持久化 ⬜ 未开始

**目标**：MCP 识别工作区，持久化芯片/烧录/调试/RTT/串口配置到工作区，后续复用。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/core/workspace/types.ts` | WorkspaceConfig, ChipConfig, FlashConfig 等 |
| `src/core/workspace/config-schema.ts` | Zod schema（含版本字段） |
| `src/core/workspace/workspace-config.ts` | load/save/validate/detectConflicts |
| MCP 新增工具 | `init_workspace`, `get_workspace_config`, `update_workspace_config` |

### 关键架构决策

1. **配置文件路径**：`<workspaceRoot>/.linkterm/config.json`，含 schemaVersion
2. **敏感数据 schema 级拒绝** — Zod schema 显式拒绝 password/privateKey/token/secret 字段
3. **冲突检测** — 配置 vs 硬件证据不匹配时返回结构化冲突报告，需用户确认
4. **缺失字段返回结构化提示** — 不静默失败

### 依赖阶段：Phase 4

### 相对工作量：1.5x

---

## Phase 9: J-Link MCP Surface ⬜ 未开始

**目标**：实现独立的 J-Link 调试/烧录/RTT/GDB MCP surface，无 backend 时安全拒绝。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/jlink/types.ts` | IJLinkBackend 接口 |
| `src/jlink/null-backend.ts` | 无 backend 时所有操作返回结构化拒绝 |
| `src/jlink/jlink-adapter.ts` | 具体适配器（初始 stub） |
| `src/mcp/surfaces/debug/` | Debug 工具实现、schema、backend 注册 |

### J-Link 工具清单

`probe_detect/connect/disconnect/status`, `cpu_reset/halt/run/step`, `breakpoint_set/clear/list`, `register_read/write/list`, `memory_read/write`, `flash_download/erase/write/verify`, `rtt_connect/read/clear/search`, `gdb_server_start/stop`, `snapshot_capture`, `crash_diagnose`

### 关键架构决策

1. **IJLinkBackend 纯接口 + null-backend** — 无 backend 时全部返回 `{ success: false, error: { code: 'NO_BACKEND' } }`
2. **Debug 输出与终端 transcript 隔离** — 使用 EvidenceKind.debug_output
3. **Fatal error 分类** — 退出码 0 但含 fatal marker → 仍分类为失败
4. **jlinkmcp 引用需先许可证审查** — 当前未声明 license，不得复制源码

### 依赖阶段：Phase 4

### 相对工作量：2x

---

## Phase 10: UI MCP 工具 ⬜ 未开始

**目标**：提供 MCP 控制运行中 Electron UI 的工具（配置和截图取证）。

### 交付物

| 工具 | 用途 |
|---|---|
| `ui_configure` | 受限修改 UI 状态：语言、连接类型、字段值 |
| `ui_screenshot` | 捕获 BrowserWindow 为 PNG，返回路径+元数据 |

### 关键架构决策

1. **UI 配置白名单** — 只允许改语言/连接类型/字段值，不可执行代码或打开 URL
2. **截图用 Electron 原生 API** — `BrowserWindow.webContents.capturePage()`
3. **App 未运行返回结构化失败** — `{ success: false, error: { code: 'APP_NOT_RUNNING' } }`
4. **UI evidence 与终端/debug evidence 隔离** — EvidenceKind.ui_screenshot

### 依赖阶段：Phase 4, Phase 6

### 相对工作量：1x

---

## Phase 11: 许可证管理 🟨 部分完成（Phase 0 已建立基础）

**目标**：实现第三方许可证归因、清单维护和校验。

> **当前状态**：Phase 0 已完成基础设施：`third-party-manifest.json`、`licenses/` 目录（5 个核心依赖）、`scripts/validate-licenses.ts` 双向校验脚本、`pnpm run validate:licenses` 命令。后续阶段每次新增依赖需补全清单和许可证文件。

### 交付物

| 文件 | 用途 |
|---|---|
| `third-party-manifest.json` | 每个运行时依赖的名称/版本/许可证类型/文件路径 |
| `licenses/` | 每个依赖的许可证文件 |
| `scripts/validate-licenses.ts` | 双向校验：package.json ↔ manifest ↔ license 文件 |

### 验收标准

- `npm run validate:licenses` 通过
- 缺少许可证文件 → 校验失败
- 新增依赖未更新清单 → 校验失败

### 相对工作量：0.5x

---

## Phase 12: 集成测试 + 收尾 ⬜ 未开始

**目标**：端到端集成、边界场景覆盖、错误恢复、性能验证、生产就绪。

### 边界场景覆盖（需求文档第 6 节）

| 场景 | 测试位置 |
|---|---|
| 串口连接但无数据 | integration/serial-no-data |
| 自动发现为空，手动输入 | integration/serial-manual-entry |
| 串口热插拔 | integration/serial-hotplug |
| 普通模式半包/二进制数据 | integration/serial-binary-data |
| 终端模式超时不切换模式 | integration/send-and-wait-timeout |
| SSH 字段未填切换类型 | integration/connection-type-switch |
| 命令回显后输出结果 | integration/echo-then-result |
| 工作区配置版本过旧 | integration/workspace-version-migration |
| 高影响操作缺确认 | integration/high-impact-confirmation |
| 其他场景 | 已在 Phase 5/7/9/10 覆盖 |

### 性能测试

- TranscriptBuffer 100k+ 事件
- WriteQueue 并发负载
- xterm.js 快速输出渲染

### 验收标准

- 所有边界场景测试通过
- `npm test` < 30s (unit) / < 2min (integration)
- `npm run build && npm run validate:licenses` 通过
- 无需 Qt、硬件即可完成验收

### 相对工作量：2x

---

## 依赖引入时间线

| 阶段 | npm 包 | 用途 |
|---|---|---|
| 0 | `electron`, `react`, `react-dom`, `typescript`, `vite`, `vitest`, `electron-builder` | 基础运行时和工具链 |
| 0 | `zustand`, `tailwindcss`, `eslint`, `typescript-eslint`, `prettier` | 状态管理、CSS、代码质量 |
| 1 | `zod` | Schema 校验（会话 ID 用 `crypto.randomUUID()` 内置） |
| 2 | `serialport` | 串口 I/O |
| 3 | `ssh2`, `node-pty` | SSH、本地 Shell |
| 4 | `@modelcontextprotocol/sdk` | MCP 协议 |
| 6 | `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` | 终端渲染 |

---

## 风险与缓解

| 风险 | 严重度 | 阶段 | 缓解 |
|---|---|---|---|
| 跨 chunk 完成检测不正确 | 高 | 7 | CompletionDetector 作为独立 FSM，先穷举分片模式单测再集成 |
| AI/人并发写入 transcript 不一致 | 高 | 5 | WriteQueue 单一瓶颈从 Phase 1 即建立；Phase 5 专项并发测试 |
| MCP + IPC 协调漂移 | 中 | 4/5/6 | 两者都只委托 SessionManager，无直接 transport 访问路径 |
| J-Link backend 抽象与实际 API 不匹配 | 中 | 9 | 从需求定义 IJLinkBackend，非从 jlinkmcp 源码；null-backend 先行 |
| TranscriptBuffer 内存增长 | 中 | 1/12 | Phase 1 设计压缩 API（保留 N 事件/字节，保持 cursor 有效） |

---

## 工作量总览

| 阶段 | 工作量 | 累计 |
|---|---|---|
| Phase 0: 项目脚手架 | 1x | 1x |
| Phase 1: 核心会话+Transcript+WriteQueue | 3x | 4x |
| Phase 2: 串口适配器 | 2x | 6x |
| Phase 3: SSH+本地 Shell | 1.5x | 7.5x |
| Phase 4: MCP 终端工具 | 2.5x | 10x |
| Phase 5: AI-人共同操作 | 2x | 12x |
| Phase 6: Electron UI | 2.5x | 14.5x |
| Phase 7: 终端规则+sendAndWait | 3x | 17.5x |
| Phase 8: 工作区配置 | 1.5x | 19x |
| Phase 9: J-Link MCP | 2x | 21x |
| Phase 10: UI MCP 工具 | 1x | 22x |
| Phase 11: 许可证管理 | 0.5x | 22.5x |
| Phase 12: 集成+收尾 | 2x | 24.5x |

**关键路径**：Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7。Phase 8-11 可在关键路径达到对应依赖后并行推进。

---

## 验证方式

每个阶段完成后执行：
1. `npm run build` — TypeScript 编译通过
2. `npm test` — 所有新增测试通过
3. 阶段验收标准逐条检查
4. 最终 Phase 12 执行需求文档第 7 节全部验收标准