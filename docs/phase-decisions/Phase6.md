# Phase 6 决策记录 — Electron UI

执行日期：2026-06-13
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：构建 xterm.js 终端渲染 UI、连接对话框、串口发现和中英文支持。

**计划交付物**（DEVELOPMENT_PLAN.md L706-714）：

| 组件 | 用途 |
|---|---|
| `TerminalView.tsx` | xterm.js 封装，订阅 transcript，渲染数据 |
| `ConnectionDialog.tsx` | 新连接表单，按类型显示对应字段 |
| `SessionTabBar.tsx` | 多会话标签栏 |
| `SerialPortPicker.tsx` | 自动扫描 + 手动输入 + 刷新 |
| `OriginIndicator.tsx` | 来源视觉指示器 |
| `useSession.ts`, `useTranscript.ts`, `useSerialDiscovery.ts` | React hooks |
| `i18n/en.ts`, `i18n/zh.ts` | 中英文本地化 |

**关键架构决策**（来自计划）：
1. xterm.js 订阅 TranscriptBuffer — 渲染与 MCP 相同统一流
2. 连接表单按类型区分 — 串口/SSH/本地 Shell 各显示对应字段
3. 串口自动扫描 on mount — 空列表显示手动输入
4. 人输入走 IPC + origin=human — 所有写入经 WriteQueue

**新增依赖**：`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`

**计划期变更（已记录）**：用户决定本阶段考虑引入 `shadcn/ui` 组件库（Tailwind v4 + Radix UI）；i18n 目录在 Phase 0 已删除将在此阶段重新创建。

**前置依赖**：Phase 5 已交付的 IPC handler（session:write/read/clear/list/status/destroy/transcript:subscribe）+ 现有 SERIAL_LIST_PORTS / SERIAL_PORT_CHANGED IPC。

**遗留问题（Phase 5 留给本阶段）**：
1. 缺少 `session:create` IPC handler，需在本阶段补
2. 建议把 `buildSession`（MCP 工具内）提到 `src/main/session-factory.ts` 共享给 IPC

## Phase 2: Exploration（代码库勘探）

### Explorer A：renderer + IPC 现状

- **Renderer 几乎空白**：`src/renderer/` 仅 4 个文件占位（App.tsx 静态卡片、index.tsx StrictMode 挂载、global.css 一行 Tailwind import、vite-env.d.ts），无 xterm / 无 store / 无 hooks / 无 i18n / 无 IPC 桥
- **关键空白：preload 完全不存在**。`app-lifecycle.ts:104-127` 的 `webPreferences` 只设了 `contextIsolation:true + nodeIntegration:false`，无 `preload` 字段。**Phase 6 必须新建 `src/main/preload.ts` 用 `contextBridge.exposeInMainWorld('linkterm', …)` 暴露 IPC**
- **`session:create` 通道常量已定义但无 handler**（`ipc-protocol.ts:13`）。MCP 工具的 `buildSession`（`tools.ts:298-365`）路由 SerialSession/SshSession/LocalShellSession，**必须抽到 `src/main/session-factory.ts` 共享给 IPC handler**
- **Phase 5 IPC 资产可直接复用**：8 个 session handler + serial 2 个，错误结构 `{success, data|error}`，错误码 `INVALID_PAYLOAD/SESSION_NOT_FOUND/QUEUE_FULL/NOT_OPEN/INTERNAL`
- **subscriberId 派生**：`session-ipc.ts:81` `subscriberIdOf(wc) = "wc:" + wc.id`，多窗口/HMR 兼容；preload 端不要造 id
- **base64 over IPC**：write 入参与 transcript 事件的 data 是 base64 字符串；renderer 喂给 xterm 前要 `atob`/`Uint8Array.from`
- **session destroy 复用 TRANSCRIPT_EVENT 通道**：`{sessionId, event:null, destroyed:true}` 判别字段，renderer 解码侧要识别
- **`serial:listPorts` 是裸返不走 wrap**：renderer 端处理路径不同（try/catch）

### Explorer B：UI / Tailwind / i18n / 测试 现状

- **Tailwind v4 已就位**（`@tailwindcss/postcss` 分包，纯 CSS-first 配置，无 `tailwind.config.*`），App.tsx 暗色调风格已定型
- **shadcn 接入难度：中**。当前完全无 `@radix-ui/* / clsx / tailwind-merge / class-variance-authority`；shadcn CLI 已支持 v4，但建议**只引入 3-5 个组件**（Dialog/Button/Tabs/Select/Input），不全套 add
- **i18n 完全空白**。推荐**自建 minimal i18n hook**（约 30 行 TS，零依赖）：`createContext + useLocale + t(key) + Record<Lang, Record<string,string>>`。理由：仅中英两种 + 键值平铺，react-i18next 过载；后期升级面仅在 hook 内部
- **测试基础设施缺口**：`vitest.config.ts` 是 `node` 环境，无 jsdom/happy-dom，`include` 不收 `*.test.tsx`，零 testing-library。建议本期补 `happy-dom + @testing-library/react + jest-dom`，用 `environmentMatchGlobs` 让 `tests/unit/renderer/**` 走 happy-dom；**xterm.js 渲染断言留 Phase 12**（canvas 在 happy-dom 下不工作）
- **xterm.js 已知坑**：(1) StrictMode 双调 effect 必须 cleanup 真 `dispose()`（不是 clear）；(2) `@xterm/xterm/css/xterm.css` 必须 import；(3) `FitAddon.fit()` 须等容器拿到非零尺寸（`requestAnimationFrame` 后再 fit）；(4) resize 双向：本地 `term.resize` + IPC `session:resize`（注意 ISession.resize? 可选，serial 没有）；(5) 用 `subscribeFrom(cursor)` 拉增量保证顺序；(6) clear 事件**不应**清空 xterm，渲染为分隔符；(7) 默认 canvas renderer 够用，跳过 webgl 避免 CSP 冲突
- **Zustand 已装（^5.0.14）**，无现有 store。建议：跨组件状态用 1 个 `useAppStore`（`activeSessionId`/`sessions`/`locale`/`connectionDialogOpen`），xterm 实例与 cursor 用 `useRef`/`useState`（不可序列化，不能进 store）
- **新依赖与许可证清单（草案）**：runtime 必加 `@xterm/xterm`/`@xterm/addon-fit`/`@xterm/addon-web-links`/`clsx`/`tailwind-merge`/`class-variance-authority`/`@radix-ui/react-dialog`/`@radix-ui/react-tabs`/`@radix-ui/react-select`（共 9 条）；devDependency 不入 manifest

## Phase 3: Clarifying（自动应答）

### 决策 1：UI 组件库

- 候选项：(a) shadcn/ui 子集 (b) 自建原始组件 (c) Material UI / Chakra
- 选中：**(a) shadcn/ui 子集**（Dialog / Button / Tabs / Select / Input / Label）
- 理由：用户在计划 L702 明确表态考虑 shadcn；与现有 Tailwind v4 + 暗色调风格契合；可控、可裁剪；License 全部 MIT/Apache-2.0/ISC 友好

### 决策 2：i18n 实现

- 候选项：(a) react-i18next (b) 自建 minimal i18n hook (c) formatjs/react-intl
- 选中：**(b) 自建 minimal i18n hook**
- 理由：仅中英两种 + 键值平铺；零依赖、零 license 负担；约 30 行 TS；MCP `ui_configure` 切换 language 时可直接调 store

### 决策 3：状态管理

- 候选项：(a) Zustand 单 store (b) Zustand 多 slice (c) Context + Reducer
- 选中：**(a) Zustand 单 `useAppStore`**
- 理由：状态规模小（活动会话/聚焦/locale/对话框开关）；Zustand 5 + React 19 + StrictMode 兼容性已验证；多 slice 是过度工程

### 决策 4：preload 暴露的 API 形状

- 候选项：(a) 一个总命名空间 `window.linkterm.session.*` / `linkterm.serial.*` (b) 平铺 `window.linkterm.sessionWrite` / `linkterm.sessionRead` (c) 直接暴露 `ipcRenderer`
- 选中：**(a) 命名空间分组**：`window.linkterm.session.{create,write,read,clear,list,status,resize,destroy,subscribe}`、`linkterm.serial.{listPorts,onPortChanged}`
- 理由：(c) 安全风险大（绕过 contextIsolation 价值）；(b) 命名长且无组织；(a) 与 IPC channel 命名 `session:xxx`/`serial:xxx` 一一对应，类型推断好

### 决策 5：subscriberId 来源

- 候选项：(a) renderer 端为每个 hook 实例生成 UUID (b) 主进程按 webContents.id 派生（已就位）
- 选中：**(b) 沿用 Phase 5 的 `subscriberIdOf(wc)`**
- 理由：Phase 5 已稳定，多窗口/HMR/重连兼容；renderer 不需要管 id 也不应该管（contextIsolation 下 id 是不可信信息）

### 决策 6：xterm.js 渲染策略

- 候选项：(a) 订阅 `transcript:event` 推送增量（每事件 term.write） (b) 周期性 `session:read(cursor)` 拉取 (c) 混合（首次 read 全量 + 后续订阅）
- 选中：**(c) 混合**：mount 时 `session:read({cursor:0})` 拿历史 → 立即 `transcript:subscribe` 接增量；unmount 时不取消订阅（订阅按 webContents 生命周期，destroy 时主进程自动清）
- 理由：保证从历史的开头开始 replay，且不丢任何 mount-之后 event；与 Phase 5 `readForSubscriber` 的 cursor 推进语义对齐

### 决策 7：clear 事件渲染

- 候选项：(a) term.clear() 真清屏 (b) 渲染分隔符 `--- cleared at HH:MM:SS ---` (c) 仅记录，不在 xterm 显示
- 选中：**(b) 分隔符**
- 理由：req §4.5 clear 不能丢历史，xterm 上保留分隔符让 AI/人都能看到边界；(a) 破坏审计语义；(c) UI 体验差

### 决策 8：连接对话框字段策略

- 候选项：(a) 单页表单按 connectionType 切换字段 (b) 三个独立 Tab (c) 向导式分步
- 选中：**(a) 单页表单 + 顶部 connectionType 选择器**
- 理由：低复杂度；用户切换类型时未填字段保留在内存（不丢失）；与现有 App.tsx 风格一致

### 决策 9：SerialPortPicker 与手动输入

- 候选项：(a) 自动扫描结果 + "manual" 按钮切换到手动输入 (b) 始终显示扫描结果 + 永远保留手动输入框 (c) 仅手动
- 选中：**(a) 自动扫描 + manual 切换**
- 理由：req §4.9 提"自动扫描为空时手动输入"；扫描有结果时强制选项更安全（防 typo）；空列表自动显示手动输入框

### 决策 10：测试范围（本 Phase 内）

- 候选项：(a) 仅写 hooks 单测，不测组件 (b) hooks + 组件渲染测试（happy-dom）+ 不测 xterm 渲染 (c) 全套含 xterm canvas 断言
- 选中：**(b) hooks + 组件渲染（happy-dom）+ xterm 实例 mock**
- 理由：xterm canvas 在 happy-dom 不工作（Phase 12 集成测试覆盖）；组件交互逻辑/字段切换/IPC mock 是 testing-library 甜区

### 决策 11：i18n 文件位置

- 候选项：(a) `src/renderer/i18n/{en,zh,index}.ts` (b) `src/shared/i18n/...`（renderer + main 共享）
- 选中：**(a) renderer 内**
- 理由：本期文案只在 renderer 用；main 进程暂无 user-facing 文案；如未来 MCP `ui_configure` 需要枚举可选语言再考虑提到 shared

### 决策 12：origin 视觉指示（2026-07-15 修订）

- 候选项：(a) 在 transcript 行首加图标（人/AI/系统） (b) 整行底色区分 (c) 仅在 OriginIndicator 组件统一显示当前会话最近来源
- 原选方案 **(a) + (c)** 的 xterm 行首 `[A]` / `[H]` 前缀已按用户反馈废止。
- 当前选中：**仅保留 (c)** —— 终端画面使用设备/PTY 的正常 echo，不显示人类或 AI 来源标签；来源仍记录在 transcript、Activity Center 和 OriginIndicator，供协作感知与审计使用。
- 理由：共享终端应保持普通 shell 体验；serial/SSH/local-shell 本地再次回显会造成命令重复，且可见 `[H]`/`[AI]` 破坏可读性。RTT log 无可靠上行 echo 时继续使用原始本地回显。

### 决策 13：测试基础设施补充时机

- 候选项：(a) Phase 6 必补（happy-dom + testing-library + 配置 environmentMatchGlobs） (b) 推迟到 Phase 12
- 选中：**(a) 本期必补**
- 理由：组件不写测试就是空头承诺；env 配置改动一次全 Phase 受益；增加的 dev 依赖不入 manifest

## Phase 4: Architecture（候选 + 选中）

执行日期：2026-06-13；并行派 3 个 `feature-dev:code-architect` 子代理（agentId: a08f3d2189cb303d9 / aeb862cc759b7970c / af88480d1beba9524）。

### 方案 A — Minimal Changes（agentId: a08f3d2189cb303d9）

**核心**：能塞进现有文件就不另开；hooks 直调 preload；shadcn 只取必要 6 个；测试基建增量改动。

**亮点**：
- `session:create` 合并进 `session-ipc.ts`（不另开文件）
- `session-factory.ts` 放 `src/transports/`（避 mcp 依赖 main）
- 最小新增、变更面小、首交付快
- 文件约 30 个新增

**代价**：
- hooks 散落 channel 细节，未来加新 IPC 要改 preload+global.d.ts+hooks 三处
- 多组件场景下 base64 解码逻辑会重复
- xterm 跨 chunk 前缀处理简化（首行带 [A]，多行 chunk 中间不重复）

### 方案 B — Clean Architecture（agentId: aeb862cc759b7970c）

**核心**：分层（preload → ipc-client → store/hooks → ui-primitives → 业务组件 → AppShell），TerminalView 等业务组件只接 props，store 拆 sessions/ui/locale 三 slice。

**亮点**：
- `IpcClient` 接口 + DI（`live` / `fake`），单测无需 mock window.linkterm
- 安全审计面更小（preload 纯透传，归一化集中 ipc-client.live）
- Phase 7+ 演进：`sendAndWait`/UI surface/workspace 都只需在 IpcClient 加方法
- xterm 与 store 解耦（独立 useXterm hook）

**代价**：
- 文件数比 Minimal 多 60%+
- IpcClient 抽象在仅 9+2 个方法规模下偏冗余
- 多 slice 在小团队场景纪律松懈时易出循环引用
- 首交付慢、构建初次冷启动 +3-5s

### 方案 C — Pragmatic Balance（agentId: af88480d1beba9524）✅ **选中**

**核心**：preload 命名空间分组（替代 ipc-client SDK 层）；单 Zustand store + selector 工具；hook 层集中解码 base64；shadcn 6 个 primitive；shared `PreloadAPI` 类型双向消费；MCP `tools.ts` 与 IPC 共享同一 `buildSession`。

**关键决策细节**：
- `src/main/preload.ts`：暴露 `linkterm.session.{create,write,read,clear,list,status,resize,destroy,subscribe}` + `linkterm.serial.{listPorts,onPortChanged}` + `linkterm.transcript.onEvent`
- `src/main/session-factory.ts`：抽出 `buildSession(id, OpenSessionInput)`，MCP `tools.ts` 也消费
- `src/main/ipc/session-create-handler.ts`：独立 handler 文件（与 session-ipc.ts 平级）
- `src/shared/preload-api.ts`：`PreloadAPI` 类型契约
- `src/shared/transcript-ipc-types.ts`：把 `SerializedTranscriptEvent` 从 `session-ipc.ts` 提到 shared
- `src/renderer/lib/render-event.ts`：base64 解码 + 行级 ANSI 前缀（A=紫 H=青 S=黄）+ clear 分隔符的**单一收敛点**
- `useTranscript` 启动序：`session.read({cursor:0})` 拿历史 + `transcript.onEvent` 注册全局监听 + `session.subscribe` 触发主进程 broadcast；忽略 subscribe 返回的 events，只信流式 onEvent（避免重复）
- ResizeObserver + 非零尺寸守卫 + StrictMode dispose ref-guard
- 测试基建：`environmentMatchGlobs: [['tests/unit/renderer/**','happy-dom']]`，xterm 用 `vi.mock` stub

**实施顺序**（6 步）：
1. main 基础（shared 类型 + session-factory + session:create handler + preload.ts + main/index.ts 装配）
2. renderer 基建（zustand + 测试基建 + store + i18n + lib/cn）
3. shadcn 6 个 primitive（CLI add）+ 许可证清单更新
4. hooks 三件套（useSession / useSerialDiscovery / useTranscript）
5. 业务组件（OriginIndicator → SerialPortPicker → ConnectionDialog → SessionTabBar → TerminalView）
6. App.tsx 装配 + 集成测试

**依赖增量**（runtime，全部 MIT/Apache-2.0）：
- `zustand`（已装 ^5.0.14，验证）
- `@xterm/xterm`、`@xterm/addon-fit`
- `@radix-ui/react-dialog`、`@radix-ui/react-tabs`、`@radix-ui/react-select`、`@radix-ui/react-label`、`@radix-ui/react-slot`
- `class-variance-authority`、`clsx`、`tailwind-merge`

**dev**：`happy-dom`、`@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom`

### 选中理由（为何选 C，非 A 非 B）

按 `/next-phase.md` 默认规则：除非 ≥3x 选 Clean / ≤1x 选 Minimal，否则一律 Pragmatic Balance。Phase 6 工作量 2.5x（DEVELOPMENT_PLAN.md），刚好落在 Pragmatic。

补充判断：
- Minimal 把 base64 解码散在多组件，违反 \"render-event 单一收敛点\" 的可维护诉求；hooks 直调 preload 的耦合在 Phase 6 多组件场景已开始显形
- Clean 的 IpcClient SDK 在 9+2 个方法规模下是过度抽象（现阶段主要 IPC 已稳定，Phase 7 sendAndWait 也只是新增几个方法）；额外抽象层会拖累 Phase 6 已达 2.5x 工作量的首交付
- Pragmatic 的"preload 命名空间 + hook 集中解码 + shared `PreloadAPI` 类型"恰好解决方案 A/B 各自的痛点，且把可复用边界精确卡在"两处以上调用"的真实复用点

## Phase 5: Implementation（实施摘要）

### 交付件清单

**新增文件（共 33 个）：**

- 主进程：`src/main/preload.ts`（contextBridge 暴露 `window.linkterm`）、`src/main/session-factory.ts`（统一 buildSession 给 MCP open_session 与 IPC session:create 复用）、`src/main/ipc/session-create-handler.ts`
- 共享类型：`src/shared/preload-api.ts`、`src/shared/transcript-ipc-types.ts`（从 session-ipc 拆出，让 renderer 可 import 而不依赖 src/main）
- 渲染层：`src/renderer/lib/cn.ts`、`src/renderer/lib/render-event.ts`、`src/renderer/i18n/{en.ts,zh.ts,index.ts}`、`src/renderer/store/app-store.ts`、`src/renderer/hooks/{useSession,useSerialDiscovery,useTranscript}.ts`、`src/renderer/components/ui/{button,input,label,dialog,tabs,select}.tsx`、`src/renderer/components/{TerminalView,ConnectionDialog,SerialPortPicker,SessionTabBar,OriginIndicator}.tsx`、`src/renderer/App.tsx`（重写）
- 测试：`tests/setup-renderer.ts`、`tests/fixtures/mock-preload-api.ts`、`tests/unit/main/ipc/session-create.test.ts`、`tests/unit/renderer/store/app-store.test.ts`、`tests/unit/renderer/lib/render-event.test.ts`、`tests/unit/renderer/hooks/{useSerialDiscovery,useTranscript,useSession}.test.ts`、`tests/unit/renderer/components/{TerminalView,ConnectionDialog,SerialPortPicker,SessionTabBar,OriginIndicator}.test.tsx`

**修改文件：**

- `src/main/app-lifecycle.ts`：BrowserWindow 注入 `webPreferences.preload` + `sandbox: false`（ESM preload 必需）
- `src/main/ipc/index.ts`：注册 / dispose `registerSessionCreate`
- `src/main/ipc/session-ipc.ts`：`SerializedTranscriptEvent` 改为从 `shared/transcript-ipc-types` re-export
- `src/mcp/surfaces/terminal/tools.ts`：删除内联 buildSession，改 import 自 `main/session-factory`
- `vitest.config.ts`：移除 Vitest 4 已删除的 `environmentMatchGlobs`，新增 `tests/setup-renderer.ts` 到 setupFiles；renderer 测试使用 `// @vitest-environment happy-dom` 文件级指令
- `third-party-manifest.json` + `licenses/`：补齐 10 个新增 runtime 依赖（react、react-dom、zustand、@xterm/xterm、@xterm/addon-fit、@radix-ui/react-{dialog,tabs,select,label,slot}、class-variance-authority、clsx、tailwind-merge）

### 验收命令结果

| 命令 | 结果 |
|------|------|
| `pnpm run lint` | PASS |
| `pnpm test` | 229 通过 / 0 失败（24 文件） |
| `pnpm run build` | tsc + vite 双绿 |
| `pnpm run validate:licenses` | 19 依赖全部对齐 |

### 实施期决策与变更记录

1. **Vitest 4 兼容性**：原设计用 `environmentMatchGlobs` 让 `tests/unit/renderer/**` 跑 happy-dom，但 Vitest 4.1.8 已移除该选项。改为每个 renderer 测试文件首行 `// @vitest-environment happy-dom` 指令（共 8 个文件）。setup 仍走 `tests/setup-renderer.ts` 注入 jest-dom 与 ResizeObserver/Element prototype 兜底。
2. **session-create-handler 测试用 `vi.hoisted`**：原写法把 `ipcMainMock` 定义在模块顶层会被 `vi.mock` 提升到 import 之前导致 ReferenceError。用 `vi.hoisted(() => ({...}))` 让 mock state 与 mock factory 一起提升。
3. **OriginIndicator 边界条件**：`opacityFor` 与 pulse 谓词原本用 `!ts` 判断"无活动"，但 `ts === 0` 也是合法时间戳（测试场景）。改为 `ts === undefined` 严格判断。
4. **SerialPortPicker auto-upgrade 与显式选择竞争**：用户点击 manual 按钮后，若 ports 非空且 value 为空，原 `useEffect` 会立即把 mode 拉回 auto。新增 `userChoseMode` ref guard：用户显式调用 `chooseMode` 后，不再触发自动升级，仅初始 mount 与首次出现端口时升级一次。
5. **SSH `hostVerifier` 默认拒绝**：`session-factory.ts` 内硬编码 `() => false`，等 Phase 8 TOFU/known_hosts 落地后再放开。renderer 与 IPC 都不暴露此选项，符合"无 acceptAll 默认"的 Phase 4 约束。
6. **TerminalView ref state 显式标注类型**：tsc 严格模式下 `const state = { term, fit, disposed: false }` 推断不出 optional 字段（`onDataDispose`、`resizeObserver`），后续赋值会报 TS2339。把 state 字面量显式标注为带 optional 字段的对象类型即可。

### 关键不变量复核

- IPC `session:write` 仍硬编码 `origin: 'human'`，renderer 无法伪造 AI 身份（req §4.4 / §5.1）
- preload 仅暴露白名单 API，从不向 renderer 转发 `ipcRenderer` 句柄；`subscribe()` 返回 unsubscribe 函数，绝不暴露 `removeAllListeners`
- 二进制 IPC 用 base64（renderer 无 Buffer），TextDecoder 在模块级别共享一个实例，`fatal: false` 防止半字节字符崩窗
- xterm StrictMode 安全：dispose 在 cleanup 真正执行 `term.dispose()`，并用 `disposed` 标记 + ref-guard 防止 ResizeObserver/onData 后续触发
- Phase 4 Transport 不变量保持：CSP header、SSH 凭据非持久化、PTY exit 走 system 事件、close 单次 emit 都未触动

## Phase 6: Review（三视角评审）

执行日期：2026-06-13；并行派 3 个 `feature-dev:code-reviewer` 子代理（agentId: a3741e0fcc8813807 / a14b54f0afd03cb38 / a03aad3be282018e0）。

### 合并报告（按严重度分组，三方去重）

#### Critical（必修）
- **C1 [A+B] `src/renderer/hooks/useTranscript.ts:37-67` 启动期 read+subscribe 竞态丢事件**：read({cursor:0}) 与 subscribers.set 之间产生的 sequence > read.cursor 事件被显式忽略。修：以 `subscribe()` 返回 events 作为唯一快照（删除 read 调用），或保留 read 后用 subscribe events 中 sequence>readCursor 部分做 gap-fill。

#### High（必修）
- **H1 [B] `src/renderer/lib/render-event.ts:66-96` 跨事件前缀重复注入**：系统消息多事件未感知行尾，第二事件起始仍重复加 `[S]`。修：仅对 system 维护行状态；human/ai 出站事件不在 serial/SSH/local-shell 终端本地渲染。
- **H2 [A+B+C] `src/renderer/components/ConnectionDialog.tsx:117` 双层 cast 走私 SSH 凭据**：`as unknown as AnySessionConfig`。修：`shared/preload-api.ts` 引入 `SessionCreateRequestConfig`（含 SSH credentials）联合类型，消除 cast。
- **H3 [A] MCP serializeEvent 与 IPC serializeEvent schema 不一致**：MCP `data+dataEncoding:'base64'` vs IPC `dataBase64`。修：收敛到 `shared/transcript-ipc-types.ts` 单一 serializer。
- **H4 [A] `IpcResult<T>` 与 `PreloadResult<T>` 双写**。修：删 `IpcResult`，main 直接 import shared。
- **H5 [A+C] session-factory 跨层倒挂**：`src/mcp/` 反向依赖 `src/main/`。修：迁到 `src/core/session/factory.ts`，main 与 mcp 都 import core。

#### Medium（一并修）
- **M1 [B] TextDecoder 未启用 stream → UTF-8 跨 chunk 截断**：`render-event.ts:22,93`。修：`decode(bytes, {stream:true})`，按 (sessionId, origin) 维护 decoder map。
- **M2 [B] `serial.listPorts` 静默吞错**：preload 直返不走 wrap。修：让 IPC handler 走 `wrap`，preload 返回 `PreloadResult<T>`。
- **M3 [A+B] 字符串匹配 fallback** `/not found/i` 与 `'is not open'`：脆弱。修：引入 `SessionNotFoundError` 命名错误（与 `SessionNotOpenError` 一致），删除字符串 fallback。
- **M4 [B] `markOriginActivity` 高频 set 致重渲染**：`useTranscript.ts:56-58`。修：250ms 节流（或 rAF）。
- **M5 [A+C] 错误码魔法字符串散落**。修：`src/shared/error-codes.ts` 集中 const 对象。
- **M6 [C] manifest 版本与 package.json 漂移**：多个新增 caret 范围未对齐。修：把 manifest 中各 `version` 字段对齐 package.json。
- **M7 [C] shadcn ui/* 缺 JSDoc**：所有 forwardRef 导出无 JSDoc。修：每个 export 补一行 JSDoc。
- **M8 [A] `store/app-store.ts:23` `state: string` 失去类型保护**。修：用 `SessionState` 类型。
- **M9 [A] ConnectionDialog FormField 重复模式 ≥10 次**。修：抽 `<FormField id label>{children}</FormField>`。

#### Low（推迟，记录即可）
- L1 [B] 主进程 `decodeBase64` try/catch 死代码（Buffer.from 不抛错）
- L2 [B] `useTranscript` 不主动 unsubscribe（带宽浪费非泄漏）
- L3 [B] `TerminalView` ResizeObserver 首回调用默认 80×24
- L4 [A] `OriginIndicator.__test__` 包装层冗余
- L5 [C] `app-lifecycle.ts:139` 注释误导（stub 未接入）
- L6 [C] vitest setup 全局加载（非污染但语义不清）— 可推迟到测试基建优化期

### 处置：派实施 agent 修复 Critical + High + Medium，Low 推迟到 Phase 7+

### 修复实施

**完成日期**：2026-06-13
**验收**：`pnpm run lint`（clean）+ `pnpm test`（237/237 通过，新增 8 用例）+ `pnpm run build`（成功）+ `pnpm run validate:licenses`（19/19 PASS）

#### Critical
- **C1**：`useTranscript.ts` 删除 `read({cursor:0})`，改以 `subscribe()` 返回的 events 作唯一历史快照；先注册 `transcript.onEvent` 再 `subscribe`，杜绝事件丢失。新增测试：subscribe 返回 N 条 + 后续 onEvent N+1/N+2 全部到达且每个字符仅出现一次。

#### High
- **H1**：`render-event.ts` 引入 `RenderState`（`lineState: Map<sessionId, {lastOrigin, atLineStart}>` + `decoders: Map`）。同 origin 多事件不再重复注入前缀；跨 origin 切换且非行首时先补 `\r\n` 再插前缀；以 `\n` 结尾的 chunk 重新进入行首态。`useTranscript` 在 `useRef` 中持有 RenderState，session destroyed 时调用 `disposeSessionRenderState` 清理。新增 4 个 H1 用例覆盖。
- **H2**：`shared/preload-api.ts` 新增 `SshCredentialsPayload` / `SshSessionConfigWithCredentials` / `SessionCreateRequestConfig`；`ConnectionDialog.buildConfig` 直接返回该联合类型，删除 `as unknown as AnySessionConfig` cast。
- **H3**：`shared/transcript-ipc-types.ts` 新增 `serializeTranscriptEvent()` + 同构 `encodeBase64`（Node Buffer / 浏览器 btoa 兜底）。MCP `tools.ts` 与 IPC `session-ipc.ts` 共用同一序列化器，schema 单一来源（`dataBase64`）。
- **H4**：删除 main 侧 `IpcResult<T>` 重复定义；统一 import `PreloadResult/PreloadOk/PreloadFail` from `shared/preload-api.ts`。仅保留 `export type { PreloadResult as IpcResult }` 作向后兼容别名。
- **H5**：`src/main/session-factory.ts` 删除，迁到 `src/core/session/factory.ts`；MCP `tools.ts` 与 `session-create-handler.ts` 都从 core import，跨层倒挂消除。

#### Medium
- **M1**：`render-event.ts` 单例 TextDecoder 改为按 `${sessionId}\\0${origin}` 维护的 decoder Map，`decode(bytes, {stream:true})` 跨 chunk 流式解码。新增 2 个用例：`[0xE4, 0xB8]+[0xAD]` 重组 `中`；多 session decoder 互不串扰。
- **M2**：`serial-ipc.ts` 的 `serial:listPorts` 用 try/catch 包成 `PreloadResult<ReadonlyArray<SerialPortInfo>>`；preload 类型同步更新；`useSerialDiscovery` 处理 `success:false` 不污染 store。
- **M3**：`src/core/session/types.ts` 新增 `SessionNotFoundError`（`code='SESSION_NOT_FOUND'`），从 `src/core/session/index.ts` re-export。`SessionManager.#requireSession` 抛此错；MCP `tools.ts` 与 IPC `session-ipc.ts` 用 `instanceof` 识别，删除 `/not found/i` 字符串嗅探。
- **M4**：`useTranscript.ts` 新增 `lastOriginAtRef` Map，每 (sessionId, origin) 节流 250ms 才落一次 `markOriginActivity`，避免 device 高频流量灌爆 store。历史快照回放不触发活动通知。
- **M5**：`src/shared/error-codes.ts` 集中 `ERROR_CODES` const + `ErrorCode` 类型；IPC handler / MCP wrap / `decodeBase64` 错误路径统一引用。
- **M6**：`third-party-manifest.json` 8 个依赖版本对齐 `package.json`（@radix-ui/* / class-variance-authority / clsx / tailwind-merge）。
- **M7**：`src/renderer/components/ui/` 全部 forwardRef 导出补 JSDoc（DialogOverlay/Title/Description、TabsList/Trigger/Content、SelectTrigger/Content/Item）。
- **M8**：`store/app-store.ts` `state` 字段类型从 `string` 改为 `SessionState`；`SessionTabBar.tsx` 删除 `as TranslationKey` cast，改 `as const`；preload-api / session-ipc / session-create-handler / preload.ts 同步将 `state: string` 全部升级为 `SessionState`。
- **M9**：新增 `src/renderer/components/ui/form-field.tsx`；`ConnectionDialog.tsx` 用 `<FormField>` 替换 ~10 处 grid+Label+Input 重复模式。

**MCP ToolErrorCode 扩展**：为承接 M3 的命名错误，`src/mcp/registry.ts` 的 `ToolErrorCode` 联合新增 `'SESSION_NOT_FOUND'`；旧 `'NOT_FOUND'` 保留但当前不再被使用。`tests/unit/mcp/terminal-tools.test.ts` 中"unknown session id"用例的期望值同步更新。

**测试增量**：229 → 237（+8），全部通过。新文件：`src/core/session/factory.ts`、`src/shared/error-codes.ts`、`src/renderer/components/ui/form-field.tsx`；删除文件：`src/main/session-factory.ts`。

#### 推迟项（与评审决议一致）
Low 级 L1–L6 全部记录但未在本次修复范围内动手；按"Phase 7+ 再处理"处置。

## Phase 7: Summary（验收）

（待最终验收）
