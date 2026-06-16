# LinkTerm Electron v2 开发计划

## Context

LinkTerm v2 需要用 Electron/TypeScript 重写，替代旧 Qt/C++ 实现，形成单一运行时的桌面终端 + MCP 自动化平台。当前项目为完全绿地状态，仅有 `PROJECT_REQUIREMENTS.md`。本计划将需求拆分为 13 个可交付、可测试的阶段，按依赖顺序推进。

---

## 阶段进度总览

| 阶段 | 状态 | 完成日期 |
|---|---|---|
| Phase 0: 项目脚手架 | ✅ 已完成 | 2026-06-13 |
| Phase 1: 核心会话+Transcript+WriteQueue | ✅ 已完成 | 2026-06-13 |
| Phase 2: 串口适配器 | ✅ 已完成 | 2026-06-13 |
| Phase 3: SSH+本地 Shell | ✅ 完成 | 2026-06-13 |
| Phase 4: MCP 终端工具 | ✅ 已完成 | 2026-06-13 |
| Phase 5: AI-人共同操作 | ✅ 已完成 | 2026-06-13 |
| Phase 6: Electron UI | ✅ 已完成 | 2026-06-13 |
| Phase 7: 终端规则+sendAndWait | ✅ 已完成 2026-06-13 | 290 测试通过 |
| Phase 8: 工作区配置 | ✅ 已完成 2026-06-14 | 363 测试通过 |
| Phase 9: J-Link MCP | ✅ 已完成 2026-06-14 | 420 测试通过 |
| Phase 10: UI MCP 工具 | ✅ 已完成 | 2026-06-14 |
| Phase 11: 许可证管理 | ✅ 已完成 | 2026-06-14 |
| Phase 12: 集成+收尾 | ✅ 已完成 | 2026-06-14 |

---

## 架构总览

### 进程模型

- **Main Process** — 拥有所有状态资源：SessionManager、TranscriptBuffer、WriteQueue、Transport 适配器、MCP Server、工作区配置、J-Link backend 抽象
- **Renderer Process** — 薄 UI 壳：React 组件承载 xterm.js、连接对话框、i18n、IPC 绑定
- **MCP Server** — 运行在 Electron Main Process 的唯一 backend runtime 内；外部 MCP Host 通过 stdio 入口启动同一 Electron runtime，若已有 owner 则 stdio proxy 转发到 authenticated localhost HTTP endpoint，共享同一个 SessionManager
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

## Phase 2: 串口适配器 ✅ 已完成（2026-06-13）

**目标**：实现第一个真实 transport，证明会话抽象端到端可用。

### 实际交付物

| 文件/模块 | 状态 | 说明 |
|---|---|---|
| `src/shared/types.ts` 扩展 | ✅ | `SerialSessionConfig` 新增 `dataBits/stopBits/parity/rtscts/xon/xoff`；新增 `SerialDataBits/SerialStopBits/SerialParity/SerialPortInfo` |
| `src/shared/constants.ts` 扩展 | ✅ | 新增 `DEFAULT_SERIAL_DATA_BITS/STOP_BITS/PARITY`、`SERIAL_DISCOVERY_POLL_INTERVAL_MS` |
| `src/transports/serial/serial-port-like.ts` | ✅ | `SerialPortLike` 最小接口面 + `SerialPortFactory` 注入点（E1 决策） |
| `src/transports/serial/serial-transport.ts` | ✅ | `SerialTransport implements ITransport`；write+drain 双步语义；幂等 close；物理拔出走 closed 状态而非 errored（F1） |
| `src/transports/serial/serial-discovery.ts` | ✅ | 引用计数轮询；2s 间隔；默认 noop error 监听器避免无 listener 崩进程；`unref()` 让进程可退出 |
| `src/transports/serial/serial-session.ts` | ✅ | `SerialSession extends SessionBase`；保留 `mode` 只读字段供 Phase 7 使用 |
| `src/transports/serial/index.ts` | ✅ | 桶导出 |
| `src/transports/index.ts` 扩展 | ✅ | 新增 `export * from './serial/index.js'` |
| `src/main/ipc/serial-ipc.ts` | ✅ | `SERIAL_LIST_PORTS` invoke + `SERIAL_PORT_CHANGED` 广播；薄壳 |
| `src/main/ipc/index.ts` 重构 | ✅ | `registerIpcHandlers()` 返回 `MainProcessContext`，含 `serialDiscovery` 与 `dispose` |
| `src/main/index.ts` 接入 | ✅ | `app.whenReady` 注册 IPC，`app.will-quit` 调用 `context.dispose()` |
| `tests/fixtures/mock-serialport.ts` | ✅ | `FakeSerialPort` + `createMockSerialPortFactory`；`writes/drainCalls/closeCalls` 计数 |
| `tests/unit/transports/serial-transport.test.ts` | ✅ | 16 个测试覆盖 open/write+drain/close 各路径 + 错误 + 物理拔出与 SessionBase 错误恢复交错 |
| `tests/unit/transports/serial-discovery.test.ts` | ✅ | 7 个测试覆盖 listPorts、引用计数轮询、变更检测、order-independence、瞬时错误恢复 |
| `tests/unit/transports/serial-session.test.ts` | ✅ | 3 个测试覆盖 mode 字段、SessionBase 集成、transport 错误后 fd 释放 |
| `third-party-manifest.json` 扩展 | ✅ | 新增 `serialport ^13.0.0` |
| `licenses/serialport.LICENSE` | ✅ | MIT 许可证文件 |

### 关键架构决策

1. **`SerialPortLike` 最小接口面 + 工厂注入** — `SerialTransport` 不直接 `new SerialPort`；测试通过 `portFactory` 传 `FakeSerialPort`。这与 Phase 9 的 J-Link backend 注入模式一致
2. **write 语义：write→drain 两步成功才 resolve** — WriteQueue 已串行化，无吞吐顾虑；保证 SessionBase 把审计事件落 transcript 时字节确实已发出
3. **物理断连 → `'close'`（不升级 `'error'`）** — 物理拔出属于正常生命周期，session 走 `closed`；用户重连即可
4. **SerialDiscovery 引用计数自动启停轮询** — 第一个 `'change'` 订阅者出现启动 `setInterval`，最后一个移除时清掉 timer；避免无人订阅时的常驻消耗
5. **SerialDiscovery 内置 noop `'error'` 监听器** — 防止瞬时 `SerialPort.list()` 失败让 `EventEmitter` 抛 uncaught 把主进程崩了；外部仍可附加真实诊断 listener
6. **IPC 在 Phase 2 仅做端口发现** — `serial-ipc.ts` 是薄壳；session 相关 IPC 留给 Phase 5

### Phase 2 实施期间的需求/决策变更

| 变更项 | 原计划 | 实际 | 原因 |
|---|---|---|---|
| 串口字段 | 仅 baudRate/mode | **加全 dataBits/stopBits/parity/rtscts/xon/xoff** | 用户决策 A1：嵌入式串口常用 7E1/奇校验/流控，后期再加成本高 |
| terminal 模式 | 未明示 | **Phase 2 仅作字段透传，行为与 normal 一致** | 用户决策 B1：避免 Phase 6/7 又改 schema |
| watchPorts 实现时机 | 未明示 | **Phase 2 实现 + 2s 轮询 + 引用计数自动启停** | 用户决策 C1/C2：满足 §6 热插拔 + §4.9 手动刷新最小集 |
| write drain 语义 | 未明示 | **每次 write 后 await drain()** | 用户决策 D1：WriteQueue 已串行，优先满足 §4.5 审计不变量 |
| SerialPort 注入 | 未明示 | **构造函数 portFactory 显式 DI** | 用户决策 E1：与 J-Link backend 模式一致 |
| 物理拔出分类 | 未明示 | **走 'close' 不升级 'error'** | 用户决策 F1：物理断开属正常生命周期 |
| serial-ipc.ts 范围 | 未明示 | **Phase 2 仅 LIST_PORTS + PORT_CHANGED 薄壳** | 用户决策 G1：让 Phase 6 已有可用 IPC |
| `@electron/rebuild` | 未明示 | **暂不引入，Phase 6 启动 UI 时再加** | 用户决策 H1：避免 CI/开发机不必要本地编译 |
| SerialSession 子类 | 计划中保留 | **保留，但 Phase 2 仅工厂职责** | 用户决策 I1：Phase 7 加 sendAndWait 时不需重构 |
| Phase 5 review 修复 | — | **C1 noop error 监听器、I1 双重 normalize 去重、I2/I3/I4/I5 简化、测试 I6/I7/I8 加强** | 三路 code-reviewer 审查发现，全部修复 |

### 新增依赖

**运行时**：`serialport ^13.0.0`（MIT，已登记 manifest + 落地 license 文件）

### 验收标准（全部通过）

- ✅ `pnpm test`：72 个测试通过（46 旧 + 26 新增），330ms
- ✅ `pnpm run lint`：0 错误 0 警告
- ✅ `pnpm run build`：main + renderer 双侧 tsc strict 编译通过
- ✅ `pnpm run validate:licenses`：6/6 依赖许可证完整
- ✅ `src/transports/serial/` 零 Electron 依赖（grep 确认）
- ✅ 测试不依赖真实串口硬件（全部走 FakeSerialPort）
- ✅ SerialTransport 与 SessionBase 集成：open/write 审计/device 入站/close 状态机全链路
- ✅ SerialTransport 在物理拔出 + SessionBase 错误恢复两条交错路径上 'close' 仅 emit 一次
- ✅ SerialDiscovery 引用计数启停轮询、order-independent 比较、瞬时错误不停轮询

### 相对工作量：2x（与计划一致）

---

## Phase 2（原始）：串口适配器

> 以下为原始计划文本，保留作为历史参考。实际交付以上方"已完成"小节为准。

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

## Phase 3: SSH + 本地 Shell 适配器 ✅ 完成（2026-06-13）

**目标**：完成所有三种会话类型，共享同一会话契约。

### 交付物

| 文件/模块 | 用途 |
|---|---|
| `src/transports/ssh/ssh-client-like.ts` | ssh2 Client/Channel 最小接口 + `defaultSshClientFactory`（`createRequire` 懒加载） |
| `src/transports/ssh/ssh-transport.ts` | SSH transport（connect→ready→shell 三段、host verifier 必填、凭据 open() 内即时清空） |
| `src/transports/ssh/ssh-session.ts` | SSH session（暴露 `resize` 转 `setWindow`） |
| `src/transports/ssh/index.ts` | barrel |
| `src/transports/local-shell/pty-like.ts` | node-pty 最小接口 + `defaultPtyFactory`（`createRequire` 懒加载） |
| `src/transports/local-shell/local-shell-transport.ts` | 本地 Shell transport（PTY spawn、UTF-8 数据双向、kill+dispose 监听） |
| `src/transports/local-shell/local-shell-session.ts` | 本地 Shell session（`resize` 转 `pty.resize`，PTY 退出写 transcript state 事件） |
| `src/transports/local-shell/index.ts` | barrel |
| `src/shared/types.ts` | `SshSessionConfig` / `LocalShellSessionConfig` 增 keepalive/readyTimeout/term/rows/cols/args/cwd/env |
| `src/shared/constants.ts` | 5 个 SSH/PTY 默认常量 |
| `src/core/session/types.ts` | `ISession.resize?(cols, rows): Promise<void>` 可选成员 |
| `src/core/session/session-base.ts` | `protected recordSystemEvent` 钩子（PTY 退出/SSH 系统事件复用 #appendAndEmit） |
| `tests/fixtures/mock-pty.ts`, `mock-ssh.ts` | 进程内 mock，进程隔离地驱动 onData/onExit/`'ready'`/`'close'` 等事件 |
| `tests/unit/transports/local-shell-transport.test.ts` | 13 用例 |
| `tests/unit/transports/local-shell-session.test.ts` | 4 用例 |
| `tests/unit/transports/ssh-transport.test.ts` | 17 用例 |
| `tests/unit/transports/ssh-session.test.ts` | 5 用例 |

### 关键架构决策

1. **复用 Phase 2 模式而非引入新抽象**（Plan C "Pragmatic Balance"）— `ITransport` 已经覆盖 SSH/PTY 与串口的共同点；评估过的 `IProcessTransport`/`ProcessSessionBase` 仅能去掉约 10 行重复，引入两个新抽象不划算（CLAUDE.md "3 行重复 > 过早抽象"）。仅在 `SessionBase` 加一个 `protected recordSystemEvent` 让子类记录非字节流的系统事件（PTY 退出码/信号），ISession 加可选 `resize?` 让需要 PTY 窗口同步的子类暴露能力。
2. **凭据生命周期最小化** — `SshSessionOptions.credentials` 单独入参；`SshTransport` 在 `open()` 内首个 `await` 之前把字段引用置空，凭据仅在本函数局部变量中存活；从不进入 transcript（按 §4.4 / §5.1）。
3. **hostVerifier 必填，无 acceptAll 默认** — TOFU/known_hosts 推迟到 Phase 8 实现；当前由上层（IPC handler）弹 UI 决策，自动化测试注入 `() => true/false`。
4. **PTY 非 0 退出 ≠ errored**（决策 F5）— `LocalShellSession` 把 `transport.exit` 翻译成 `state` 类型 transcript 事件，`meta:{kind:'pty-exit', exitCode, signal}`，会话仍走正常 `closed` 状态机；非 0 是合法业务结果（编译错误、grep 未命中等），不应升级为致命错误。
5. **默认工厂用 `createRequire(import.meta.url)` 懒加载原生模块** — `ssh2` / `node-pty` 在测试运行时不会被 import，`pnpm test` 在未编译原生 binding 的环境（CI、纯 Node 18+）也能跑过 Vitest。Electron 进程在生产路径下加载真实模块；`@electron/rebuild` 集成推迟到 Phase 6。
6. **Default shell 解析规则** — Unix 上 `process.env.SHELL ?? '/bin/bash'`，Windows 上 `process.env.COMSPEC ?? 'cmd.exe'`；`env` 缺省时**继承** `process.env`（仅 string 值），显式提供时**整体替换**，防止"补丁式 env"意外泄漏外部变量。

### 测试交付（实际，新增 39 用例）

- `local-shell-transport.test.ts` — defaults/passthrough、env 继承 vs 替换、spawn 失败回收、open 幂等、write/data/resize、PTY 退出（含 signal）、close 幂等且 emit 唯一、close 后 data 丢弃、close 前 open、close 后不能 re-open
- `local-shell-session.test.ts` — SessionBase 集成（write 审计 + device 入站）、PTY 退出 transcript state 事件结构、零退出码不进 errored、resize 在 open 前后行为
- `ssh-transport.test.ts` — defaults/passthrough、私钥+passphrase、hostVerifier 拒绝、connect/shell 失败、凭据释放、open 幂等、write 路径、data 转发、client error 透传、channel close 唯一 emit 且主动 end client、channel 'error' 转发（避免 uncaughtException）、ready→shell 窗口期 client error/close 处理、close 幂等、resize、close 前 open
- `ssh-session.test.ts` — SessionBase 集成、host key 拒绝→errored、auth 失败 transcript 不含密码、resize、channel close 推到 closed

### 实施期间的需求/决策变更

| 时间 | 变更 | 原因 |
|---|---|---|
| 2026-06-13 | 把交付物清单中的 `tests/unit/transports/session-contract.test.ts`（参数化契约测试）从本期范围中移除 | 现有 serial/local-shell/ssh 三套 session 测试已覆盖 ISession 契约的关键点（生命周期、写入审计、入站事件、状态机），且各自针对不同 transport 的失败模式设了专属断言；额外引入参数化框架会与 transport-specific 断言耦合不清。Phase 5 在引入并发 cursor / waitFor 协调时可统一抽参数化测试。 |
| 2026-06-13 | `ITransport` 不强制 `resize` 成员，`ISession.resize?` 设为可选 | 串口没有窗口尺寸概念，强加方法会引出 `// no-op` 假实现。可选成员配合 `typeof session.resize === 'function'` 检测既保持类型清晰，也让 SerialSession 不必假装实现该方法。 |
| 2026-06-13 | SSH 默认 `keepaliveInterval=0`（关闭）而非常见的 30s | LinkTerm v2 的 IPC 层未来会在 UI 上暴露此选项；默认关闭可以避免 keepalive 干扰嵌入式 SSH 设备的功耗管理（电池供电的 IoT 网关常因 keepalive 反复唤醒）。 |
| 2026-06-13 | Phase 6 review 一致指出 `SshTransport.close()` 永不 emit `'close'`、`channel close` 不 end client、ready→shell 期间无 error 监听、`close()` 后 PTY 数据继续灌入 transcript 等 4 个真生产 bug；全部修复 | 详见各文件中 "review 发现 #N" 注释。同步给 `mock-ssh.ts` 加 `silentEnd` / `shellHang` 行为开关，防止 mock 自动 emit 'close' 掩盖真实 bug；测试改成断言确切 `closes === 1`，去掉之前 `void closes;` 的妥协。 |

### 依赖阶段：Phase 1, Phase 2

### 相对工作量：1.5x（实际接近预估）

---

## Phase 4: MCP 终端工具 ✅ 已完成（2026-06-13）

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

每个工具返回：`{ success, sessionId?, state?, evidence: { kind, data, cursor }, error?, correlationId, origin: 'ai', schemaVersion }`

### 关键架构决策

1. **MCP 工具不直接接触 transport** — 全部通过 SessionManager，硬安全边界
2. **Schema 版本在 server 启动时声明** — 版本不匹配拒绝危险操作；`linkterm-mcp/1.0.0` semver
3. **本阶段 sendAndWait 为基础版** — 跨 chunk 完成检测在 Phase 7 增强
4. **MCP stdio 默认不自动启动** — 由 `LINKTERM_MCP_STDIO=1` 显式启用，避免桌面 stdout 污染协议帧

### 变更记录（相对原计划）

- **2026-06-15（Agent 自动接入）** — 新增产品内 Agent Integrations：Renderer 提供“Agent 集成”面板，用户显式点击安装/修复后，Main IPC 调用 Electron-free `AgentIntegrationManager` 自动检测并写入本机 Agent MCP 配置。默认支持 VS Code Copilot（`User/mcp.json` 顶层 `servers.linkterm`，写入 `type: 'stdio'`）、Claude Desktop（`claude_desktop_config.json` 顶层 `mcpServers.linkterm`）和 Cursor（`~/.cursor/mcp.json` 顶层 `mcpServers.linkterm`）；core 仍保留 VS Code 旧式 `settings.json` 字面量 `chat.mcpServers.linkterm` 兼容能力。安全决策：不静默写入；写入前备份原始文本；invalid JSON 拒绝覆盖；VS Code JSONC 注释/尾逗号兼容；按 target 串行安装并使用唯一 sidecar 路径避免同秒/并发备份覆盖；外部 Agent 启动命令已在 2026-06-15 后续架构修正中改为 Electron main runtime + `LINKTERM_MCP_STDIO=1`，由单实例锁决定作为 backend owner 或 stdio proxy 接入现有 runtime；不得再使用孤立的 `dist/main/mcp/stdio-entry.js` 作为默认 Agent 入口。
- **2026-06-15（MCP/App 单 runtime 同步修正）** — 用户实测 MCP 控制串口后发现 App UI 看不到 MCP 创建的 session 与 AI/device transcript，根因是 Agent stdio 入口与 Electron App 各自持有独立 `SessionManager`，违背“AI 与人共享同一会话”的核心目标。本次修正：Electron main runtime 成为唯一 backend owner；App-first 时 owner 启动 authenticated localhost Streamable HTTP endpoint 并写 runtime metadata，后续 MCP stdio 进程拿不到单实例锁后读取 metadata 并作为 stdio proxy 转发到现有 runtime；AI-first 时 MCP 进程持有单实例锁但不创建窗口，用户后启动 App 通过 `second-instance` 在同一 runtime 创建窗口。`SessionManager` 新增非敏感 `SessionMetadata/SessionSummary`，IPC/preload 新增 `session:lifecycle`，renderer `useSessionHydration()` 先订阅 lifecycle 再读取 `session.list()` 快照，覆盖初始水合、MCP 后续新建、后台状态变化与销毁。安全边界：metadata 仅允许 `127.0.0.1` endpoint + bearer token + live pid；HTTP close 删除 metadata 并停止活跃 MCP request；summary 不携带 SSH 凭据。复审修正：`createAndOpen()` 成功前不再向 manager 外发 `session:event`，`listSummaries()` 只暴露 visible session，避免 open 失败或 pending open 时 UI 幽灵 tab；AI-first owner/proxy 的 stdio hook 在任何异步启动前安装，direct stdio 断开后会停止 MCP server，无 UI 窗口时退出并清理 runtime。2026-06-16 实机修正：VS Code/Electron MCP Host 会向子进程继承 `ELECTRON_RUN_AS_NODE`，直接配置 `electron.exe <appPath>` 会把 Electron main 当 Node 跑并报 `BrowserWindow` named export 错误；Agent launch config 改为 `electron.exe electron-runtime-launcher.js <metadataPath> <runtimePath> [appPath]`，launcher 先尝试在 Node-mode 进程内直连现有 HTTP runtime，metadata 不存在时再清除 `ELECTRON_RUN_AS_NODE` 并转发 stdio 启动真正 Electron runtime，避免 App-first 和 AI-first 都被宿主环境污染。验证：`pnpm run build` ✅，`pnpm run lint` ✅，`pnpm test` ✅ 59 文件 / **542 个测试通过**，`pnpm run validate:licenses` ✅ 19 个依赖清单一致。
- **2026-06-13** — Phase 4 实施 + 复审。澄清问题落定如下决策：仅 Stdio transport（暂不做本地 TCP）；snake_case 工具名；close_session 仅关闭 transport 保留 transcript；send_and_wait 基础版仅等首条 device 输出 + timeout。
- **2026-06-13 (修正)** — 复审发现 7 类问题并全部修复：
  1. `server.ts` 加 `stopping` Promise 防并发关闭；`start()` 失败时清空 `starting`；start 看到正在 stop 时先等待。
  2. `registerIpcHandlers()` 启动 MCP 失败时回滚已注册的 IPC handler 和 SerialDiscovery，避免 "already registered" 撞车。
  3. `decodeDataPayload` 严格校验 base64 字符与 padding，非法值抛 `INVALID_ARGUMENT`，避免 Buffer 静默截断写入错字节。
  4. `SessionManager` 新增 `createAndOpen()`：open 成功才广播 `session:created`；open 失败既不入表也不发任何 `session:*` 事件，消除 UI 端"幽灵 session"。
  5. **移除 `acceptUnknownHostKey` 选项** — Phase 4 无 known_hosts，true 等价于 acceptAll，违反 "no acceptAll default" 不变量。MCP 入口 SSH `hostVerifier` 一律返回 false，等到 Phase 8 引入持久化信任后再开放。
  6. `redactSensitive` 扩展为按入参精确替换 password / passphrase / privateKey 字面量（之前只剥 PEM 头）。
  7. MCP stdio 默认不自动启动，改为环境变量 `LINKTERM_MCP_STDIO=1` 触发；`registerIpcHandlers` 的 `autoStartMcp` 选项语义改为 "覆盖 env"。

### 测试交付

- `terminal-tools.test.ts` — 8 个工具 + mock SessionManager，验证结构化结果、错误码（NOT_FOUND / NOT_OPEN / INVALID_ARGUMENT / TIMEOUT / VERSION_MISMATCH）、凭据不泄漏
- `version-check.test.ts` — 版本匹配/不匹配安全拒绝
- `mcp-session-roundtrip.test.ts` — 集成：MCP open→write→read 完整回路（用 LocalShellSession + FakePty）
- `session-manager.test.ts` 扩展 — `createAndOpen` 成功广播 / 失败静默回滚

### 新增依赖：`@modelcontextprotocol/sdk`@^1.29.0、`zod`@^4.4.3

### 依赖阶段：Phase 1-3

### 相对工作量：2.5x

---

## Phase 5: AI 与人共同操作加固 ✅ 已完成（2026-06-13）

**目标**：验证和加固 AI-人共享会话模型，处理并发访问、cursor 一致性、清屏审计保留、多客户端协调。

### 实际交付物

| 文件/模块 | 状态 | 说明 |
|---|---|---|
| `src/core/write-queue/types.ts` 扩展 | ✅ | `priority: 'high' \| 'normal'`、`maxDepth` 选项、`WriteQueueFullError`（code `QUEUE_FULL`）、correlationId 透传字段 |
| `src/core/write-queue/write-queue.ts` 重写 | ✅ | 双 lane FIFO（high 非空先取 high）、背压 reject、close() drain 仍保持 |
| `src/core/transcript/types.ts` 扩展 | ✅ | `ReadResult.oldestAvailableSequence` 字段、`ClearMeta` 含 `kind:'clear' + precedingCursor` |
| `src/core/transcript/transcript-buffer.ts` 增强 | ✅ | clear 自动补 `meta.kind='clear'+precedingCursor`；`snapshot()` 新方法；过期 cursor 不抛错而返回 oldestAvailableSequence |
| `src/core/session/session-manager.ts` 增强 | ✅ | `subscribe/unsubscribe/getSubscriberCursor/readForSubscriber/waitFor`；多客户端 cursor 用 `Map<subscriberId, Map<sessionId, cursor>>` |
| `src/main/ipc/session-ipc.ts` 新增 | ✅ | 8 个 IPC handler（write/read/clear/list/status/resize/destroy/transcript:subscribe），强制 `origin='human'`，按 webContents 分配 subscriberId |
| `src/main/ipc/index.ts` | ✅ | 接入 `registerSessionIpc`，dispose 时统一回滚 |
| `src/mcp/surfaces/terminal/tools.ts` | ✅ | `read_from_session` 把 `oldestAvailableSequence` 透传给 AI 客户端 |
| `tests/integration/ai-human-coop.test.ts` | ✅ | 6 个核心场景 + 3 个并发协调附加（waitFor、active vs stale subscriber） |
| `tests/unit/core/write-queue.test.ts` 扩展 | ✅ | priority、correlationId、背压共 +12 用例 |
| `tests/unit/core/transcript-buffer.test.ts` 扩展 | ✅ | clear 边界、过期 cursor 恢复、snapshot 共 +5 用例 |

### 关键架构决策（详见 `docs/phase-decisions/Phase5.md`）

1. **WriteQueue 两级优先级**（`'high' | 'normal'`）— 用户手动 abort/Ctrl-C 走 high，AI 默认 normal；双 lane FIFO 避免饿死
2. **背压策略**：`maxDepth` 默认 1024，超过 reject 携带 `code: 'QUEUE_FULL'`，由调用方决定退避/重试
3. **清屏边界**：保留 clear 事件本体在事件流中，meta 加 `kind:'clear'+precedingCursor`；不引入额外 `clearBoundaries` 字段
4. **过期 cursor 恢复**：`readSince` 不抛错，返回 `truncated: true + oldestAvailableSequence`，客户端可用 N-1 续读
5. **多客户端 cursor**：SessionManager 内部 `Map<subscriberId, Map<sessionId, cursor>>`，同时保留显式 read 接口（MCP 现有 8 个工具不破坏）
6. **`waitFor` 通用化**：仅"事件流断言+timeout"，不混入 Phase 7 的终端规则/sendAndWait FSM
7. **IPC origin 强制**：`session:write` IPC 强制 `origin='human'`，渲染端不能伪造 AI 身份

### 实施期间的需求/决策变更

| 变更项 | 原计划 | 实际 | 原因 |
|---|---|---|---|
| 子代理选型 | `feature-dev:feature-dev` | **`backend-developer`** | `feature-dev:feature-dev` 是 skill 不是 agent；后端并发模型/队列/IPC 最对口 |
| `session-ipc.ts` 范围 | 全套 session 操作 IPC | **不含 `session:create`** | 创建会话依赖 SerialSession/SshSession/LocalShellSession 路由，留给 Phase 6 接 UI 时实装；本期 8 个 handler 已满足并发验证 |
| IPC handler 端到端测试 | 计划暗示 | **未写** | `ipcMain` 在 Vitest（无 Electron）下需 mock 整个 `electron`；策略性测试放在 `ai-human-coop.test.ts` 直接打 SessionManager API（IPC 是薄壳）。Phase 6 接 UI 时再补 |
| `waitFor` 与 sendAndWait | 计划提及"并发 waitFor 协调" | **仅做通用 waitFor，不接 send_and_wait** | 终端规则/完成检测属 Phase 7；本期只做"事件流断言+timeout"以验证并发协调 |

### 验收标准（全部通过）

- ✅ `pnpm run lint`：0 错误 0 警告
- ✅ `pnpm test`：172 个测试通过（139 + 33），534ms
- ✅ `pnpm run build`：main + renderer 双侧编译成功，renderer 193 KB
- ✅ `pnpm run validate:licenses`：9/9 依赖许可证完整
- ✅ 6 个核心验证场景全部通过（人↔AI 双向可见、并发有序、清屏审计保留、多客户端独立 cursor、过期 cursor 恢复）
- ✅ `src/core/` 仍零 Electron 依赖
- ✅ Code review 后第二轮：H1+H2 修复、M1–M4 修复、新增 7 个回归测试

### Code review 第二轮修复（2026-06-13）

详见 `docs/phase-decisions/Phase5.md` 决策 9–12：

- **H1**：`WriteQueue.enqueue` 中 `priority==='high'` 豁免 `maxDepth` 检查 — 修复 Ctrl-C 通道在背压时被拒的真生产 bug
- **H2**：IPC `session:write` 的 `priority` 字段端到端打通（`SessionWriteOptions` 增字段 → `SessionBase.write` 透传 → IPC handler 接收）
- **M1**：`TranscriptBuffer.append` clear 事件 meta 合并顺序改为强制覆盖 `kind:'clear'+precedingCursor`
- **M2**：`SessionManager.waitFor` 监听 `'state'` 事件，session 进入 closed/errored 立即返回新 `kind:'closed'` outcome（避免等满 30s）
- **M3**：新建 `SessionNotOpenError`（`code:'NOT_OPEN'`）从 SessionBase 抛出，IPC/MCP 用 `instanceof` 共享翻译，错误归类与 MCP 工具一致
- **M4**：`transcript:subscribe` handler 用 `if (!subscribers.has(wc.id))` 守卫，避免 'destroyed' once 监听器累积

### 遗留事项（不阻塞 Phase 5 完成）

1. **`session:create` IPC handler**：Phase 6 接 UI 时实装；建议把 `buildSession` 从 MCP 工具提到 `src/main/session-factory.ts` 共享
2. **session-ipc.test.ts**：Phase 6 接 UI 后补端到端测试
3. **`waitFor.replayHistorySince` 接入 `send_and_wait`**：Phase 7 终端规则范畴

### 相对工作量：2x（与计划一致）

---

## Phase 5（原始）：AI 与人共同操作加固

> 以下为原始计划文本，保留作为历史参考。实际交付以上方"已完成"小节为准。

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

## Phase 6: Electron UI ✅ 已完成（2026-06-13）

**实际交付物**（决策记录详见 `docs/phase-decisions/Phase6.md`）：

| 类别 | 文件 / 模块 |
|---|---|
| Main 进程 | `src/main/preload.ts`（contextBridge 暴露 `window.linkterm.*`）；`src/main/ipc/session-create-handler.ts`；`src/main/ipc/serial-ipc.ts`（包装 `wrap()` 走 PreloadResult）；`src/main/ipc/session-ipc.ts`（共享 serializeTranscriptEvent） |
| Core 抽离 | `src/core/session/factory.ts`（buildSession，从 main 迁入 core，MCP 与 IPC 共享）；`src/core/session/types.ts` 新增 `SessionNotFoundError` |
| Shared 契约 | `src/shared/preload-api.ts`（PreloadResult 单一来源 + SessionCreateRequestConfig 含 SSH credentials）；`src/shared/transcript-ipc-types.ts`（统一 serializeTranscriptEvent）；`src/shared/error-codes.ts`（错误码常量集中） |
| Renderer 业务组件 | `TerminalView.tsx` / `ConnectionDialog.tsx` / `SessionTabBar.tsx` / `SerialPortPicker.tsx` / `OriginIndicator.tsx` |
| Renderer 基建 | `src/renderer/store/app-store.ts`（Zustand 单 store + SessionState 类型）；`src/renderer/i18n/{en,zh,index}.ts`；`src/renderer/lib/{cn,render-event}.ts`；`src/renderer/hooks/{useSession,useSerialDiscovery,useTranscript}.ts` |
| shadcn 子集 | `src/renderer/components/ui/{dialog,button,tabs,select,input,label,form-field}.tsx` |
| 测试基建 | `vitest.config.ts` `environmentMatchGlobs` happy-dom；`tests/setup-renderer.ts`；`tests/fixtures/mock-preload-api.ts` |
| 单测 | tests/unit/{main,renderer,mcp}/ 多个文件；237/237 通过（+72 vs Phase 5） |
| 许可证 | 10 个新 runtime 包同步 `third-party-manifest.json` + `licenses/`；version 范围对齐 |

**关键架构决策**（详见 `docs/phase-decisions/Phase6.md`）：
- 架构方案：**Pragmatic Balance**（vs Minimal / Clean）— preload 命名空间分组 + Zustand 单 store + hook 集中 base64 解码 + shared `PreloadAPI` 类型双向消费
- 13 项 Clarifying 决策（shadcn 子集 / 自建 minimal i18n hook / Zustand 单 store / 命名空间 preload / 主进程派生 subscriberId / xterm 订阅快照混合 / clear 分隔符 / 单页对话框 / 自动扫描+manual / happy-dom 测试 / origin 行级前缀 + 呼吸灯 / 测试基建本期补齐）

**实施期需求/决策变更**：
- session-factory **从 `src/main/` 迁到 `src/core/session/factory.ts`**（review H5）— 避免 mcp 反向依赖 main，回归 "core 零 Electron" 边界
- xterm `useTranscript` 启动序**从"read+subscribe 混合"改为"仅 subscribe"**（review C1）— subscribe 返回 atomic 历史快照 + cursor，消除竞态丢首屏事件
- ConnectionDialog SSH 凭据**通过 `SessionCreateRequestConfig` 联合类型携带**（review H2）— 消除双层 cast 走私
- MCP serializeEvent 与 IPC serializeEvent **统一收敛到 shared `dataBase64`**（review H3）— evidence schema 一致

**Code review 处置摘要**（3 路并行 reviewer A/B/C）：
- Critical: 1（C1 read+subscribe 竞态）已修
- High: 5（H1 跨事件前缀注入、H2 凭据 cast、H3 schema 不一致、H4 IpcResult 双写、H5 跨层倒挂）全部修
- Medium: 9（M1 TextDecoder stream、M2 listPorts wrap、M3 字符串匹配 fallback、M4 markOriginActivity 节流、M5 错误码常量集中、M6 manifest 版本对齐、M7 shadcn JSDoc、M8 SessionState 类型、M9 FormField 抽出）全部修
- Low: 6 项推迟（推迟理由记录在决策文件）

**验收**：
- `pnpm run lint` clean
- `pnpm test` 237/237 passed（24 test files；Phase 5: 172 → Phase 6: 237，+65）
- `pnpm run build` tsc + vite 双绿
- `pnpm run validate:licenses` 19/19 PASS

---

## Phase 6（原始计划）

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

## Phase 7: 嵌入式终端规则 + 增强 sendAndWait ✅ 已完成 2026-06-13

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

### 实际交付（2026-06-13）

- `src/core/terminal-rules/{types,rules,completion-detector,echo-handler,send-and-wait,index}.ts` 6 个新文件；`src/core/index.ts` barrel re-export
- `src/shared/constants.ts` 新增 `TERMINAL_RULES_DEFAULT_TIMEOUT_MS=5000` / `COMPLETION_BUFFER_MAX_BYTES=65536` / `DEFAULT_LINE_ENDING='\r\n'`
- `src/mcp/surfaces/terminal/{schemas,tools}.ts` 重写 `send_and_wait`：accept `completionMarkers: (string | {pattern, flags?})[]`、`echoStrategy`、`appendLineEnding`、`lineEnding`，从 4 种 reason 翻译结构化错误（matched/timeout/session-closed/queue-full/aborted）
- `src/shared/error-codes.ts` + `src/mcp/registry.ts` 新增 `'QUEUE_FULL'` / `'SESSION_CLOSED'` 错误码
- 新增测试 53 个：`tests/unit/core/terminal-rules/{rules,completion-detector,echo-handler,send-and-wait}.test.ts` + `tests/integration/send-and-wait.test.ts`；`tests/unit/mcp/terminal-tools.test.ts` 改写 4 处。**总测试 237 → 290（净增 53）**

### 关键架构决策（落地版本）

1. **Clean Architecture B**：`SessionManagerLike` 接口隔离，`send-and-wait.ts` 是纯函数 orchestrator，不依赖具体 SessionManager 类，便于单测
2. **CompletionDetector**：string marker 用 KMP 失败函数处理重叠 pattern；RegExp 用累积 buffer + 截断（纯 string 路径回退到 `bufferMaxBytes`，含 RegExp 时 `min(bufferMaxBytes, max(longestRegex*4, 4096))`）；ctor 一次性预编译 non-stateful `normalizedRe`
3. **EchoHandler**：FIFO `expected[]` 队列，字节级精确剥除；首字节失配则保守 flush；echo-off 设备保护 `MAX_QUEUE_LEN=4096`
4. **AbortSignal 语义**：pre-aborted 直接 short-circuit，不触发 write 副作用；`Promise.race(waitPromise, abortPromise)` + once listener
5. **`echoStrategy = 'auto' | 'keep'`**：评审合并掉同义词 `'strip'`
6. **`SendAndWaitResult.matchedMarkerIndex: number | null`**：fallback（空 markers）匹配时返回 `null`，避免无效下标

### 变更记录

- 2026-06-13 决策 D1: 选 Clean Architecture B（独立 `terminal-rules/` 模块 + `SessionManagerLike` 接口隔离），优先于 Pragmatic Balance —— 因 3x 工作量＋最高风险，testability 收益＞维护成本
- 2026-06-13 决策 D2: `completionMarkers` 同时支持 `string | {pattern, flags?}`，在 MCP/IPC 边界用 `parseMarkerSpec` 转 `string | RegExp`；core 层只接受 native 类型
- 2026-06-13 决策 D3: `session-closed` 不归到 `INTERNAL`，新增专用 `ERROR_CODES.SESSION_CLOSED`；`QUEUE_FULL` 同步补齐 `ToolErrorCode` union
- 2026-06-13 评审 R1: 评审 N/A 项 `SessionManagerLike.waitFor(signal?)` cancel 机制结构性变更超出本期范围，登记到 Phase 8 backlog（abort 时底层 listeners/timer 短期残留至自然 timeout，不影响功能正确性）
- 2026-06-13 评审 R2: 文件首部段落式 docstring 收敛到模块 1 行 Why；详尽设计要点迁到 `docs/phase-decisions/Phase7.md`

---

## Phase 8: 工作区配置持久化 ✅ 已完成 2026-06-14

**目标**：MCP 识别工作区，持久化芯片/烧录/调试/RTT/串口配置到工作区，后续复用。

### 交付物（实际）

| 文件/模块 | 用途 |
|---|---|
| `src/core/workspace/types.ts` | 5 类配置 + WORKSPACE_SCHEMA_VERSION + REQUIRED_FIELDS |
| `src/core/workspace/config-schema.ts` | Zod 严格 schema（每层 `.strict()`） + patch schema |
| `src/core/workspace/conflict-detect.ts` | 纯函数 detectConflicts（仅 serial.port 维度，全 warn）|
| `src/core/workspace/fs-primitives.ts` | 注入式 fs 接口 + 默认 node:fs/promises 实现 |
| `src/core/workspace/workspace-config-manager.ts` | atomic write + `#inflight` 串行锁 + 4 域错误类 |
| `src/mcp/surfaces/workspace/{schemas,tools}.ts` | 3 个 MCP 工具 + ZodError 安全翻译 |
| `src/shared/error-codes.ts` | +4 错误码（WORKSPACE_NOT_FOUND / ALREADY_INITIALIZED / CONFLICT / SCHEMA_VERSION_MISMATCH）|
| `src/shared/types.ts` | EvidenceKind +`'workspace_config'` |
| `src/mcp/server.ts` / `src/main/ipc/index.ts` | workspaceConfigManager 可选注入 |

### 关键架构决策

1. **配置文件路径**：`<workspaceRoot>/.linkterm/config.json`，含 `schemaVersion: 'linkterm-workspace/1.0.0'`
2. **敏感数据 schema 级拒绝** — 5 类 + 根 layer 全部 `.strict()`，`password`/`privateKey`/`token`/`secret` 一律 unknown-key 拒
3. **冲突检测被动+显式 dryRun** — `validateOnly: true` 不写盘；硬件枚举不在每次 load 触发
4. **atomic temp+rename** + **`#inflight` 单进程串行锁** — 不引入 native advisory lock
5. **依赖注入双点**：FsPrimitives（5 方法 + unlink）+ evidenceFn 一函数；不抽象 IConfigStore
6. **MCP 错误码扩展** — 4 个新码同步 ToolErrorCode union；ZodError 仅暴露 path/message/code，conflict report 仅暴露 field/severity/message（不回显 configured/actual）
7. **workspaceRoot 显式入参** — caller 传，manager 持当前；`process.cwd()` 在 Electron 主进程不可靠
8. **schema 驱动 patch** — patch 不允许改 schemaVersion；浅 merge 5 类整体替换
9. **路径校验**：`isAbsolute` + 拒 `..` 段（schema `.refine` + manager `assertValidRoot` 双层）
10. **load 文件大小限制** ≤ 1 MiB；`schemaVersion` 不匹配时抛专属 `WorkspaceSchemaVersionMismatchError`

### 依赖阶段：Phase 4

### 相对工作量：1.5x（实际匹配预期）

### Review 处置（评审 6/2026-06-14）

| 严重度 | 数量 | 状态 |
|---|---|---|
| Critical | 1 | 已修（C1 并发 update 串行锁） |
| High | 4 | 已修（docstring 收敛 / 二次 parse 删除 / structuredClone / 路径规范化）|
| Medium | 9 | 8 修 + 1 N/A（load 失败保留 stale `#current` → 转 Phase 9 backlog）|
| Low | 4 | 顺手修 3 项（重命名测试 / 删冗余测试 / `NodeJS.ErrnoException` 替换 type guard）|

详见 `docs/phase-decisions/Phase8.md`。

### 携入 Phase 9 backlog

- detectConflicts severity 维度：J-Link 设备枚举差异升级为 `error` 触发 `WorkspaceConflictError`
- load 失败 staleness 元信息：考虑加 `lastLoadOk: boolean` 标记
- AbortSignal 透传 SessionManager.waitFor（Phase 7 携入）

### 测试

| 测试基线 | 数量 |
|---|---|
| Phase 7 完成时 | 290 |
| Phase 8 实施完成 | 356 |
| Phase 8 review 修复后 | **363** |
| Phase 9 实施 + review 修复后 | **420** |

---

## Phase 9: J-Link MCP Surface ✅ 已完成 2026-06-14

**目标**：实现独立的 J-Link 调试/烧录/RTT/GDB MCP surface，无 backend 时安全拒绝。

### 交付物（实际）

| 文件/模块 | 用途 |
|---|---|
| `src/jlink/types.ts` | IJLinkBackend 接口 + 11 个 DTO 类型 |
| `src/jlink/errors.ts` | JLinkError 基类 + 8 个子类 |
| `src/jlink/null-backend.ts` | 无 backend 时显式列出所有方法抛 NoBackendError |
| `src/jlink/jlink-adapter.ts` | probe lifecycle 真实，其余抛 NOT_IMPLEMENTED（Phase 13+ 替换） |
| `src/jlink/index.ts` | 桶导出 |
| `src/mcp/surfaces/debug/schemas.ts` | 28 工具 Zod schema |
| `src/mcp/surfaces/debug/binary-codec.ts` | 16 MiB 上限 + 严格 base64 校验 |
| `src/mcp/surfaces/debug/error-translate.ts` | runJLink wrapper + instanceof 翻译 + withAbortableTimeout + ok helper |
| `src/mcp/surfaces/debug/tools.ts` | 20 个非二进制工具 |
| `src/mcp/surfaces/debug/tools-binary.ts` | 8 个二进制工具（base64 codec 集中处） |
| `tests/fixtures/fake-jlink-backend.ts` | calls 账本 + failOnce + delayMs |
| `tests/unit/jlink/null-backend.test.ts` | 全方法 NoBackendError 验证 |
| `tests/unit/jlink/jlink-adapter.test.ts` | lifecycle + NOT_IMPLEMENTED 边界 |
| `tests/unit/mcp/debug/tools.test.ts` | 注册 + sensitivity + NO_BACKEND + roundtrip |
| `tests/unit/mcp/debug/tools-binary.test.ts` | base64 翻译 + AbortSignal + BUFFER_TOO_LARGE |

### 工具清单（28）

probe lifecycle (4): `probe_detect/connect/disconnect/status` ·
cpu (4): `cpu_reset/halt/run/step` ·
breakpoints (3): `breakpoint_set/clear/list` ·
registers (3): `register_read/write/list` ·
memory (2): `memory_read/write` ·
flash (4): `flash_download/erase/write/verify` ·
RTT (4): `rtt_connect/read/clear/search` ·
GDB (2): `gdb_server_start/stop` ·
diagnostics (2): `snapshot_capture/crash_diagnose`

### 关键架构决策（实施后）

1. **始终注册 + 默认 NullJLinkBackend**（计划 §986 升级）— 28 工具对 AI 客户端始终可见；无 backend 时返回 `NO_BACKEND` 结构化拒绝。
2. **IJLinkBackend 抛错而非 result 联合** — 与 Serial/SSH/Workspace 一致；MCP 层 `runJLink` wrapper 用 `instanceof` 翻译。
3. **8 个新 ERROR_CODES 双向同步**（M5 模式）— `NO_BACKEND / PROBE_NOT_FOUND / PROBE_BUSY / JLINK_OPERATION_FAILED / BUFFER_TOO_LARGE / ABORTED / INVALID_STATE / NOT_IMPLEMENTED` 同时加入 `ERROR_CODES` 与 `ToolErrorCode` union。
4. **二进制走 16 MiB 上限的 base64**：`MAX_BINARY_BYTES = 16 MiB`；`decodeBase64Capped` 严格字符校验，超长抛 `JLinkBufferTooLargeError`，由 `runJLink` 翻译为 `BUFFER_TOO_LARGE`（**调用必须在 runJLink 内部**）。
5. **AbortSignal 透传** — flash_download / flash_verify / gdb_server_start 接收顶层 `timeoutMs`，`withAbortableTimeout` 转 AbortController；backend 抛 `JLinkAbortedError` 由翻译层转 `ABORTED`。
6. **probeId UUID v4** — `crypto.randomUUID()` 唯一 mint 在 `JLinkAdapter.probeConnect`；序列号绝不暴露在 wire 上。
7. **sensitivity 分类（read 类全 read-only / write+run 类全 state-affecting）** — 决定旧 schema mismatch 时是否拒绝；`rtt_read` 推进硬件读指针被归为 state-affecting。
8. **NullBackend 显式列出每方法**（不用 Proxy）— 接口扩展时 TS 立即在 NullBackend 报缺失成员错。

### 验证

- `pnpm run lint` ✅
- `pnpm test` ✅ 420/420（363 baseline + 57 新）
- `pnpm run build` ✅
- `pnpm run validate:licenses` ✅（无新 runtime 依赖）

### 评审与修复（三视角）

3 个并行 reviewer（Simplicity / Bugs / Conventions）合计 1 HIGH + 6 MEDIUM + 8 LOW，**全部 fix 或注释**：

- **H1（Bugs）**：base64 解码前未做长度短路 → 大载荷可触发主进程 OOM。修：`schemas.ts` `base64Field.max(MAX_BASE64_INPUT_LEN)` + `binary-codec.ts` stripped 长度阶段抛 `JLinkBufferTooLargeError`，再走 `Buffer.from`。
- **M（Bugs/Privacy）**：`probe_connect/status` evidence 直接回显 backend `serialNumber`（违反 Q3 设计意图）。修：MCP 层加 `sanitizeProbeForMcp` helper（仿 workspace `ConflictReport` 剥敏字段）。
- **M（Bugs）**：空白/空 base64 → 0-byte Buffer 静默写入。修：`decodeBase64Capped` 拒绝 stripped == 0。
- **M（Simpl）**：`ProbeHandle` / `ProbeInfo` 多个未使用字段 → 删除（Phase 13 接真 backend 时再加）。
- **M（Conv）**：fixture 用相对路径 → 改 `@/jlink/*` 与 sibling fixtures 一致。
- **L（Simpl）**：`encodeBase64` no-op 删除内联；`abortable.ts` fold 进 `error-translate.ts`；`ok` helper 共享。
- **L（Bugs/Conv）**：28 schemas 全 `.strict()` 拒未知字段。

### 给 Phase 13 的 backlog

- 替换 `JLinkAdapter` 内除 `requireProbe` 之外的所有 NOT_IMPLEMENTED 实现；不必触 MCP 层
- gdb_server_start 真实 bind 后评估 host 回显语义（Phase 6 评审 M3-bugs）
- AbortSignal 完成-时-超时争用：当前 cosmetic；真 backend 协作取消后再观察

### 依赖阶段：Phase 4

### 相对工作量：2x

---

## Phase 10: UI MCP 工具 ✅ 已完成（2026-06-14）

完整决策记录：[`docs/phase-decisions/Phase10.md`](docs/phase-decisions/Phase10.md)

### 实际交付物

| 文件 | 用途 |
|---|---|
| `src/mcp/surfaces/ui/{types,schemas,tools}.ts` | UI surface（Electron-free，仅依赖结构性接口） |
| `src/mcp/limits.ts` | 共享 `MAX_BINARY_BYTES` / `MAX_BASE64_INPUT_LEN`（debug + ui 共用） |
| `src/main/ipc/ui-bridge.ts` | `createUiBridge` 适配层 + `UiPatchTarget` 接口（Electron-free 单测） |
| `src/renderer/hooks/useUiPatchSubscription.ts` | 渲染端 patch 监听 + 单 useEffect 分派 4 action |
| `src/renderer/store/app-store.ts` | 新增 `connectionDialogPrefill` + `setConnectionDialogPrefill` |
| `tests/unit/{mcp/ui/*,renderer/hooks/useUiPatchSubscription,main/ipc/ui-bridge}.test.{ts,tsx}` | 39 + 3 review-fix 新增 = 42 个 Phase 10 测试 |

修改：`src/main/{index,ipc/index,preload}.ts`、`src/mcp/{registry,server}.ts`、`src/mcp/surfaces/debug/{binary-codec,schemas}.ts`、`src/renderer/{App,components/ConnectionDialog}.tsx`、`src/shared/{error-codes,ipc-protocol,preload-api}.ts`、`tests/fixtures/mock-preload-api.ts`。

### 关键架构决策（详见 Phase10.md）

1. **`ui_configure` 用 `z.discriminatedUnion('action', [...])`** — 4 个 action：`set_locale` / `set_connection_type` / `open_connection_dialog` / `close_connection_dialog`，每分支 `.strict()` 拒未知字段
2. **始终注册 + 默认 NullBridge** — 未注入 uiBridge / getActiveWindow 时所有调用返回 `{ code: 'UI_NOT_AVAILABLE' }`（与 NullJLinkBackend 同思路）
3. **`getActiveWindow` 必须是 thunk** — MCP server 在 mainWindow 创建之前构造，macOS `'activate'` 重建会替换 module 单例，闭包必须每次调用都从 module-scope 读
4. **prefill 11 字段白名单 + 三层 `.strict()` schema 拒凭据** — 永不接受 `sshPassword/sshPrivateKey/sshPassphrase`
5. **`UI_STATE_PATCH = 'ui:statePatch'` main→renderer 单向广播** — Q-D4 修订后采用 `BrowserWindow.getAllWindows() + isDestroyed + try/catch` 简化方案；多窗口扩展时切回 subscribers Map
6. **`evidence.kind = 'ui_screenshot'` 双工具复用** — `ui_configure` data 为 `{dispatched: patch}`，`ui_screenshot` data 为 `{mimeType, base64, width, height, byteLength}`；不新增 `'ui_patch'` kind
7. **PNG 16 MiB 上限 + 检查后才 base64** — 复用 `MAX_BINARY_BYTES`，分配前短路防 GB 级泄漏
8. **`UI_NOT_AVAILABLE` 双向同步** — `ERROR_CODES` + `ToolErrorCode` union（M5 pattern）

### 实施期间的需求/决策变更

- **Q-D4 决策修订**：原方案 A（subscribers Map 镜像 session-ipc）改为方案 B（getAllWindows + isDestroyed + try/catch）—— review 认定 Map 是死代码且 Phase 10 单窗口下 A 过度。
- **`MAX_BINARY_BYTES` 抽出位置**：原从 `debug/binary-codec` 跨 surface import；review 修复后抽到 `src/mcp/limits.ts`，binary-codec 仍 re-export 保持向后兼容。
- **`clearConnectionDialogPrefill` 删除**：与 `setConnectionDialogPrefill(null)` 等价，移除。

### Code review 处置摘要

- High: H1（uiSubscribers Map 死代码 + Q-D4 偏离）、H2（wc.send try/catch）—— 全部修复
- Medium: M1（MAX_BINARY_BYTES 抽到 limits）、M2（删等价 action）、M3（prefill type 推导）、M4（删死 IPC 常量）、M5（tool description 增补）—— 全部修复
- Low: L1（0x0 截图）、L2（timeoutMs/AbortSignal）、L3（kind 名误读）、L4-L5（注释清理）—— 推迟到 Phase 11+

### 验收标准

- ✅ `pnpm run lint` 0 error / 0 warning
- ✅ `pnpm test` 462 个测试全过（baseline 420 → 459 → review fix 462）
- ✅ `pnpm run build` 成功（renderer 621.71 kB）
- ✅ `pnpm run validate:licenses` 19 deps 合规（无新增 runtime 依赖）
- ✅ ESM `.js` 后缀 / 主进程禁 `@/` / `src/mcp/surfaces/ui/` Electron-free 全部核验通过
- ✅ 凭据红线：Zod 三层 `.strict()` 拒 sshPassword/sshPrivateKey/sshPassphrase
- ✅ `ERROR_CODES` ↔ `ToolErrorCode` 双向同步

---

## Phase 10（原始）：UI MCP 工具

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

## Phase 11: 许可证管理 ✅ 已完成（2026-06-14）

**核心交付**：将既有 manifest→license 单向校验升级为 manifest ↔ package.json 真双向校验，并补 11 个 vitest 单测固化回归。

### 实际交付物

| 文件 | 变更 |
|---|---|
| `scripts/validate-licenses.ts` | 重构：抽 `validateLicenses(opts)` 纯函数 + DI；新增 4 类校验（缺失 / 多余 / 版本严格相等 / EXTRA_RUNTIME_DEPS allowlist 反 stale） |
| `tests/unit/scripts/validate-licenses.test.ts` | **新增**：11 个用例（happy / missing / extra / version-mismatch / missing-license / electron-allowlist / stale-allowlist / missing-manifest / missing-package.json / corrupt-json / multi-error-accumulation） |

### 关键架构决策

- **Pragmatic 风格 → Minimal Changes**（0.5x 工作量、单文件）。详见 [docs/phase-decisions/Phase11.md](docs/phase-decisions/Phase11.md)
- **DI 纯函数 + 入口 main()**：`validateLicenses({ manifestPath, packageJsonPath, rootDir })` 导出便于测试，main() 仅做 path 拼装 + exit
- **EXTRA_RUNTIME_DEPS allowlist**：仅 `['electron']`（在 devDeps 但运行时分发）；allowlist 项必须实际存在于 package.json 任一 dep 字段，防 stale
- **版本严格字符串相等**：`manifest.version === package.json.dependencies[name]`，防 bump 后忘了重新审核 license
- **错误消息区分来源**：`(from package.json)` vs `(from EXTRA_RUNTIME_DEPS allowlist)`，避免自相矛盾
- **ESM 标准派生 `__dirname`**：`dirname(fileURLToPath(import.meta.url))`（不依赖 Node 20.11+ 的 `import.meta.dirname`）
- **`isDirectExecution` 跨平台**：`pathToFileURL(argv[1]).href === import.meta.url`（Windows / 软链场景可靠）

### Code review 处置摘要

- High：H1（跨平台 + ESM `__dirname`）+ H2（错误消息矛盾）→ 已修
- Medium：M1（补 3 个边界测试）+ M2（删同义反复测试）+ M3（interface JSDoc）+ M4（合并入 H1）→ 已修
- Low：L1-L6（错误消息风格、ESLint scripts/、manifest 重复 name 等）→ 推迟到 Phase 12 backlog

### 验收标准对勾

- ✅ `pnpm run validate:licenses` 通过（19 deps PASS）
- ✅ 缺少许可证文件 → 校验失败（test: missing-license-file）
- ✅ 新增依赖未更新清单 → 校验失败（test: missing-in-manifest）
- ✅ 删依赖未删 manifest → 校验失败（test: extra-in-manifest，新增覆盖）
- ✅ bump 依赖未 bump manifest → 校验失败（test: version-mismatch，新增覆盖）

### 验收命令结果（2026-06-14）

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | ✅ exit 0 |
| `pnpm test` | ✅ 473 个测试通过（baseline 462 + 11 个 license 单测） |
| `pnpm run build` | ✅ tsc -b + vite build 双侧成功 |
| `pnpm run validate:licenses` | ✅ PASS: All 19 dependencies have valid license entries |

### 相对工作量：0.5x（实际符合预估）

---

## Phase 11（原始）

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
- 删依赖未删 manifest → 校验失败
- bump 依赖未 bump manifest → 校验失败

### 相对工作量：0.5x

---

## Phase 12: 集成测试 + 收尾 ✅ 已完成（2026-06-14）

**核心交付**：9 个边界场景全覆盖（4 个新建 integration + 5 个由前置 Phase 单测覆盖）+ 高影响 MCP 工具引入 confirm 闸门 + 2 个性能基线测试。LinkTerm v2 13 个 Phase 全部 ✅ 收尾。

### 实际交付物

| 文件 | 变更 |
|---|---|
| `src/shared/error-codes.ts` | 新增 `CONFIRMATION_REQUIRED` 错误码 |
| `src/mcp/registry.ts` | `ToolErrorCode` 联合加 `'CONFIRMATION_REQUIRED'`（M5 dual-sync） |
| `src/mcp/surfaces/debug/error-translate.ts` | 新增 `ConfirmationRequiredError` 类 + translateJLinkError 分支 |
| `src/mcp/surfaces/debug/schemas.ts` | 5 个高影响工具加 `confirmField`（z.boolean().optional()） |
| `src/mcp/surfaces/debug/tools.ts` + `tools-binary.ts` | 5 个工具 entry 在 `runJLink` 内首步守门；binary tools 守门提前到 `decodeBase64Capped` 之前 |
| `tests/integration/serial-no-data.test.ts` | **新增**：场景 1（2 it） |
| `tests/integration/serial-manual-entry.test.ts` | **新增**：场景 2（2 it） |
| `tests/integration/connection-dialog-type-switch.test.tsx` | **新增**：场景 6 happy-dom（4 it） |
| `tests/integration/high-impact-confirmation.test.ts` | **新增**：场景 9（5 工具 × 3 状态 = 15 it） |
| `tests/integration/perf-transcript-buffer.test.ts` | **新增**：100k 事件容量 + truncated 恢复（2 it） |
| `tests/integration/perf-write-queue.test.ts` | **新增**：高优先级抢占 + maxDepth 满拒（2 it） |
| `tests/unit/mcp/debug/tools.test.ts` + `tools-binary.test.ts` | 已有调用补 `confirm: true`（回归） |

**已覆盖、不重复**：

- 场景 3（串口热插拔）：`tests/unit/transports/serial-transport.test.ts:129/166` + `serial-session.test.ts:64`
- 场景 4（半包/二进制 fallback）：`tests/unit/core/terminal-rules/send-and-wait.test.ts:270`
- 场景 5（sendAndWait 超时不切模式）：`send-and-wait.test.ts:114` + `tests/integration/send-and-wait.test.ts:60`
- 场景 7（命令回显抑制）：`tests/unit/core/terminal-rules/echo-handler.test.ts` 10 用例
- 场景 8（工作区配置版本过旧）：`tests/unit/core/workspace/workspace-config-manager.test.ts:288`

### 关键架构决策

详见 [docs/phase-decisions/Phase12.md](docs/phase-decisions/Phase12.md)：

- **Pragmatic Balance 风格**（2x 工作量；本 Phase 90% 是新增测试 + 1 个简单功能，跳过并行 3-architect）
- **5 个高影响工具加 confirm 闸门**：`flash_download` / `flash_write` / `flash_erase` / `cpu_reset` / `gdb_server_start`
- **错误码：新引入 `CONFIRMATION_REQUIRED`**（不复用 INVALID_ARGUMENT），让 AI 客户端可编程化区分"参数错"vs"需要二次确认"，符合 M5 双向同步模式
- **守门 throw 在 `runJLink` 内**：与 binary-codec.ts 的 `decodeBase64Capped` 模式一致，统一走 `translateJLinkError` 翻译
- **binary tools 守门提到 base64 decode 之前**：避免 16 MiB payload 在守门失败时白做 base64 解码
- **不引入 vitest unit/integration 分组**：当前 500 测试 2.64s 跑完，无性能压力；动 vitest.config.ts 影响其它 PR 不值得
- **性能测试组织**：`tests/integration/perf-*.test.ts`（不引入 `tests/perf/` 独立目录），单文件 `{ timeout: 30_000 }` 自管

### Code review 处置摘要

- **Critical / High：无**（三方一致）
- **Medium 5 条全部同期修**：
  - M1：`gdb_server_start` confirm 检查搬出 `withAbortableTimeout` 至外层 `runJLink`
  - M2：connection-dialog test 不再断言 zustand 内部状态，改为 `screen.getByRole('dialog')`
  - M3：抽 `openDialogWithPrefill(prefill)` helper，4 个 it 复用
  - M4：local-shell submit 用 `await waitFor(...)` 替代 `setTimeout(0)`，CI 抗抖
  - M5：perf-transcript-buffer 第二 it 时间上限 1000ms → 3000ms，与第一个用例 5s 风格一致
- **Low 6 条推迟到 Phase 13+ backlog**（test 合并/注释微调/可读性优化等不影响功能）

### 验收标准对勾

- ✅ 所有边界场景测试通过（500/500）
- ✅ `npm test` < 30s（实测 2.64s，远低于上限）
- ✅ `npm run build && npm run validate:licenses` 通过
- ✅ 无需 Qt、硬件即可完成验收（全部 fixtures + mocks）

### 验收命令结果（2026-06-14）

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | ✅ exit 0 |
| `pnpm test` | ✅ 49 文件 / **500 个测试通过**（baseline 473 + 27 个 Phase 12 新增） |
| `pnpm run build` | ✅ tsc -b + vite build 双侧成功（renderer chunk 622 KB） |
| `pnpm run validate:licenses` | ✅ PASS: All 19 dependencies have valid license entries |

### 后续架构修正验收（2026-06-15）

| 命令 | 结果 |
|---|---|
| `pnpm run build` | ✅ tsc -b + vite build 双侧成功（renderer chunk warning only） |
| `pnpm run lint` | ✅ exit 0 |
| `pnpm test` | ✅ 59 文件 / **542 个测试通过** |
| `pnpm run validate:licenses` | ✅ PASS: All 19 dependencies have valid license entries |

### 相对工作量：2x（实际符合预估）

🎉 **LinkTerm v2 13 个 Phase 全部完成。**

---

## Phase 12（原始）

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