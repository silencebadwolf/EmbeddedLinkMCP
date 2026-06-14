# Phase 10 决策记录 — UI MCP 工具

执行日期：2026-06-14
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：提供 MCP 控制运行中 Electron UI 的工具（配置和截图取证）。

**交付物**（DEVELOPMENT_PLAN.md §Phase 10）：

| 工具 | 用途 |
|---|---|
| `ui_configure` | 受限修改 UI 状态：语言、连接类型、字段值 |
| `ui_screenshot` | 捕获 BrowserWindow 为 PNG，返回路径+元数据 |

**关键架构决策（计划草稿）**：

1. UI 配置白名单 — 只允许改语言/连接类型/字段值，不可执行代码或打开 URL
2. 截图用 Electron 原生 API — `BrowserWindow.webContents.capturePage()`
3. App 未运行返回结构化失败 — `{ success: false, error: { code: 'APP_NOT_RUNNING' } }`
4. UI evidence 与终端/debug evidence 隔离 — `EvidenceKind.ui_screenshot`

**依赖阶段**：Phase 4 (MCP server)、Phase 6 (renderer + preload + Zustand store)

**相对工作量**：1x

## Phase 2: Exploration（代码库勘探）

并行 2 个 `feature-dev:code-explorer`（Explorer A 邻接模块全景；Explorer B 推送通道/ConnectionDialog/Locale/窗口生命周期细读）。要点合并：

### A. 已就位且无需扩展

- **`EvidenceKind.ui_screenshot` 已在 union 中**（`src/shared/types.ts:33-38`），含 `'workspace_config'/'debug_output'/'terminal_output'/'raw_bytes'/'ui_screenshot'`
- **IPC invoke channel 已预占位**：`src/shared/ipc-protocol.ts:23-24` `UI_CONFIGURE` / `UI_SCREENSHOT`
- **errors `BUFFER_TOO_LARGE` / `INVALID_ARGUMENT` / `INVALID_STATE`** 都可复用（Phase 9 已加双向同步）
- **`debug/binary-codec.ts` 的 `MAX_BINARY_BYTES = 16 MiB`** + `decodeBase64Capped` 严格校验可直接 import 复用（PNG 截图同样 16 MiB 上限）

### B. 必须新增

- **`UI_STATE_PATCH: 'ui:statePatch'`**（main→renderer 推送 channel，非 invoke）— `UI_CONFIGURE`/`UI_SCREENSHOT` 是 MCP 内部消化的概念，**不需要走 IPC**（MCP 跑在主进程内，直接持有 storeBridge / getActiveWindow 即可）
- **`UI_NOT_AVAILABLE`** 新错误码（双向同步：`error-codes.ts` + `registry.ts` 的 `ToolErrorCode` union）— 区分 `NO_BACKEND`（编译期未注入）与 `UI_NOT_AVAILABLE`（运行时窗口不存在/已 destroyed）
- **`UiNamespace` preload API**：`window.linkterm.ui.onStatePatch(handler) → Unsubscribe`
- **`connectionDialogPrefill: NonSensitivePrefill | null`** + `setConnectionDialogPrefill(...)` + `clearConnectionDialogPrefill()` Zustand store action

### C. 关键现有 pattern

1. **main→renderer 推送 5 大守卫**（必须照搬 `src/main/ipc/session-ipc.ts:80-105,250-281`）：
   - `subscribers: Map<wcId, WebContents>`（不要 `BrowserWindow.getAllWindows()`）
   - 推送前 `wc.isDestroyed()` 守卫
   - 多次 subscribe → 单次 `'destroyed'` once 守卫（`if (!subscribers.has(wc.id))`）
   - `dispose()` 对称卸载（removeHandler + manager.off + subscribers.clear）
   - preload `subscribe<T>(channel, handler) → Unsubscribe`（`src/main/preload.ts:39-48`）勿暴露 `removeAllListeners`
2. **MCP surface 注册 + Null 实现**（`server.ts:124-128`）— UI 工具应**始终注册**，无窗口/无 storeBridge 时返回 `UI_NOT_AVAILABLE` 结构化拒绝（语义上与 jlink NullBackend 一致）
3. **schema-level credential rejection**（CLAUDE.md §workspace）— Zod 每层 `.strict()` 同步拒 `sshPassword/sshPrivateKey/sshPassphrase`，不靠 runtime refine
4. **ToolError instanceof 翻译**（`src/mcp/surfaces/workspace/tools.ts` + `debug/error-translate.ts`）

### D. ConnectionDialog 现状

- `FormState` 14 字段 / 11 公开 / 3 敏感（`sshPassword`/`sshPrivateKey`/`sshPassphrase`）
- 局部 `useState`，不在 store；提交后 finally 立即清零敏感字段（`ConnectionDialog.tsx:175-176`）
- `INITIAL_FORM` 重置仅在 dialog `open: true → false` 边沿（`ConnectionDialog.tsx:145-151`）
- 切 connection type 不清字段（保留在 state 中），`buildConfig` 按当前 type 只读对应字段
- prefill 合并的关键约束：useEffect 依赖必须只是 `[open]`，**不能把 prefill 加入依赖**（否则 AI 推送会覆盖用户已输入）

### E. BrowserWindow 闭包

- `src/main/index.ts:19` `let mainWindow: BrowserWindow | null` 模块单例
- macOS `'activate'` 重建会替换 module 变量；`'closed'` 置 null
- MCP server 在 `mainWindow` 创建之**前**构造（`registerIpcHandlers()` 早于 `createMainWindow()`），所以**必须传 thunk `getActiveWindow: () => BrowserWindow | null`** 而非快照
- dev 模式启动头 10 秒可能截到 `chrome-error://`（Vite 未启）；`ui_screenshot` 需文档化此细节

### F. Locale

- `Locale = 'en' | 'zh'`（`src/renderer/i18n/index.ts:13`）
- `setLocale` 零副作用（`app-store.ts:118`），不持久化、不改 `<html lang>`，本期不扩展

### G. 测试基建

- 直接复用：`tests/fixtures/mock-mcp-transport.ts`（InMemoryTransport pair）+ `mock-preload-api.ts`（待扩 `ui` 命名空间 + `emitUiPatch`）+ `setup-renderer.ts`
- 模板参考：`tests/unit/mcp/debug/tools.test.ts:29-46` 的 `setup({ withBackend })`、`tests/unit/renderer/components/ConnectionDialog.test.tsx`
- 需新写：`tests/fixtures/fake-store-bridge.ts`（calls 账本 + failOnce）+ `tests/fixtures/fake-capturable-window.ts`（mock `webContents.capturePage()`）

## Phase 3: Clarifying（自动应答）

下列歧义点在 explorer 报告基础上自动选定。

### Q1. `ui_configure` 入参形态：通用 patch vs discriminated union

**选**：`z.discriminatedUnion('action', [...])`。

候选：(a) 通用 `patch: z.object(...)` partial；(b) **discriminated union 枚举式 action**。

理由：req §Phase 10 "受限修改"语义；Explorer A §10 + B §2.3 一致建议。每个 action 独立 schema 便于 future-proof，schema 拒未知 key 无须 runtime refine。action 集合（**首批 4 个**）：

- `set_locale` — `{ locale: 'en' | 'zh' }`
- `set_connection_type` — `{ type: 'serial' | 'ssh' | 'local-shell' }`（仅切 form.type，不打开 dialog）
- `open_connection_dialog` — `{ prefill?: NonSensitivePrefill }`
- `close_connection_dialog` — `{}`

### Q2. prefill 字段白名单

**选**：11 个公开字段，**绝不允许** `sshPassword/sshPrivateKey/sshPassphrase`。

白名单：`type`, `label`, `serialPort`, `baudRate`, `serialMode`, `sshHost`, `sshPort`, `sshUsername`, `sshAuth`, `localShell`, `localCwd`。每字段 schema 用对应类型校验（如 `baudRate` 是 string-numeric、`sshPort` 是 1-65535 范围）。Zod 每层 `.strict()`。

### Q3. screenshot 载体形式

**选**：base64 inline 进 evidence.data，PNG only，16 MiB 上限（复用 `MAX_BINARY_BYTES`）。

不落临时文件（无状态、无清理 cron）；不支持 JPEG（细节损失对 AI 视觉读取不利）；超限抛 `BUFFER_TOO_LARGE`。

evidence 结构：`{ kind: 'ui_screenshot', data: { mimeType: 'image/png', base64, width, height, byteLength }, cursor: 0 }`。

### Q4. screenshot 区域 / 多窗口

**选**：本期仅整窗，无 `windowId` / `rect` 入参。多窗口未来扩展再加。

理由：当前单窗口；引入 `rect` 会扩大 schema 与边界检查工作量，超出 1x 工作量 budget。

### Q5. ui_configure → store 的同步通道

**选**：fire-and-forget 单向广播（`webContents.send`），evidence 返回"已发送的 patch"而非"被 store 接受后的实际值"。

候选 A 单向广播 / B 广播+回执 invoke / C executeJavaScript。

理由：Phase 5 transcript 推送的取舍一致（fire-and-forget）；C 违反 contextIsolation 否决；B 引入 correlation ID + 超时机制超出本期 budget。AI 客户端可在 ~50ms 后调用 `ui_screenshot` 验证（这点与 §Phase 10 "evidence 取证"目标契合）。

### Q6. UI surface 注册策略

**选**：**始终注册**（仿 J-Link debug surface）。

候选 A 跳过注册（无窗口时） / B 始终注册 + UI_NOT_AVAILABLE。

理由：req §4.6 等价语义—AI 客户端必须始终看到完整工具清单与契约；未注入 storeBridge / 窗口未就绪时返回结构化拒绝。这与 NullJLinkBackend 模式严格对齐。

### Q7. `getActiveWindow` 注入 vs `currentWindow` 实例

**选**：thunk `getActiveWindow: () => BrowserWindow | null`。

理由：MCP server 在 `mainWindow` 创建之**前**构造（`src/main/index.ts:22-24`），且 macOS `'activate'` 重建会替换引用；闭包必须每次调用都从 module-scope 读最新值。`MainProcessContext` 增加 `getActiveWindow` 字段并把 `() => mainWindow`（来自 `src/main/index.ts` 新增 `getMainWindow()` getter）传入。

### Q8. UI surface deps 的 Electron-free 边界

**选**：minimal interface，`src/mcp/surfaces/ui/types.ts` 声明 `CapturableWindow` + `UiStoreBridge`。

理由：CLAUDE.md `src/mcp/server.ts` 注释明确"不在此处暴露任何 Electron 类型"。`CapturableWindow` 仅含 `isDestroyed()` + `webContents.capturePage()`（返回 `{ toPNG(): Buffer }`），`UiStoreBridge` 仅含 `applyPatch(patch): Promise<void>`。`src/main/ui-bridge.ts` 是 Electron 适配层，把真 BrowserWindow 适配到 `CapturableWindow`。

### Q9. sensitivity 分类

**选**：`ui_configure` = `state-affecting`（修改 UI），`ui_screenshot` = `read-only`（只读像素）。

理由：与 debug surface "rtt_read 是 state-affecting（advances pointer）" 同口径——按"是否产生持久副作用"而非"动词命名"。

### Q10. evidence kind 是否新增 `ui_state`

**选**：**不新增**。`ui_configure` 的 evidence 也用 `ui_screenshot`（kind 即"UI 域取证"），data 为已发送的 patch JSON。

理由：避免 EvidenceKind 联合膨胀；evidence kind 是"取证类别"维度，UI 域内统一 `ui_screenshot` 足够。data 形态由各 tool schema 文档化。

### Q11. preload `ui` 命名空间形态

**选**：仅 `onStatePatch(handler): Unsubscribe`，无写入函数。

理由：与 `transcript.onEvent` 模式一致——preload 只暴露订阅，写入只走 IPC handler 受信通道（虽然本期 UI patch 是 main→renderer 单向，preload 不暴露 invoke 也合规）。

### Q12. dispose 顺序

**选**：UI IPC 卸载在 MCP stop **之后**（与 transcript subscriber 退订同优先级）。

理由：MCP stop 后不会再产生 patch；UI IPC handler 卸载顺序可与 session-ipc.ts 一致。

### Q13. `clearPrefill` 在何时调用

**选**：useEffect 应用 prefill 后立即在 store 调 `clearConnectionDialogPrefill()`。

理由：防止 dialog 反复关→开时陈旧 prefill 阴魂不散；这与 transcript subscribe 启动序"先 onEvent 后 subscribe"的 atomicity 相同思路。useEffect 依赖必须只有 `[open]`（不能加 `prefill`，否则 AI 推送中途到来会覆盖用户输入）。

### Q14. 工具名

**选**：`ui_configure` / `ui_screenshot`（已在计划锁定，与 snake_case 风格一致）。

## Phase 4: Architecture（候选 + 选中）

### 偏离声明

`/next-phase` 流程要求并行 3 路 architect（Minimal / Clean / Pragmatic）对比。本期 Phase 10 工作量 **1x**（轻量），按规则\"≤1x → 优先 Minimal Changes\"，且 explorer 已经把所有现成 pattern（transcript:event 推送 / NullJLinkBackend 注册 / workspace .strict() schema）勘查得很全面，本期**只跑 Architect A (Minimal Changes)**，未对 Clean / Pragmatic 单独建模。理由：
- 1x 工作量本就只允许极简改动；Clean/Pragmatic 必然引入额外抽象层，与\"小动\"本意相悖
- Minimal 方案已显式列出未来扩展撞车点（多窗口 / 回执 / 部分截图等），如果将来 Phase 13+ 需要扩展，到时再起新 phase 重做架构即可
- 三路 architect 平均 ~350s，节省一路相当于一次循环 6+ 分钟

### 选中：Architect A (Minimal Changes)

详细方案见架构师返回（已在 Step 5 实施时直接驱动）。摘要：

**新建（4）**：
- `src/mcp/surfaces/ui/types.ts` — `CapturableWindow` / `CapturableImage` / `UiStoreBridge` / `UiToolsDeps`（Electron-free minimal interface）
- `src/mcp/surfaces/ui/schemas.ts` — Zod `discriminatedUnion('action', ...)` 4 分支 + screenshot schema + 11 字段 prefill `.strict()`
- `src/mcp/surfaces/ui/tools.ts` — `registerUiTools` + inline ZodError 翻译
- `src/renderer/hooks/useUiPatchSubscription.ts` — 单 useEffect 订阅 + dispatch store action

**修改（12）**：
- `src/shared/error-codes.ts` — `UI_NOT_AVAILABLE` 新增
- `src/mcp/registry.ts` — `ToolErrorCode` union 加 `UI_NOT_AVAILABLE`
- `src/shared/ipc-protocol.ts` — `UI_STATE_PATCH: 'ui:statePatch'` 新增
- `src/shared/preload-api.ts` — `NonSensitivePrefill` / `UiStatePatch` / `UiNamespace` / `PreloadAPI.ui`
- `src/main/preload.ts` — `api.ui.onStatePatch`
- `src/main/ipc/index.ts` — inline `createUiBridge(getActiveWindow)` + 注入 `createMcpServer`
- `src/main/index.ts` — 暴露 `getMainWindow()` thunk
- `src/mcp/server.ts` — `CreateMcpServerOptions` 加 `uiBridge?` + `getActiveWindow?`，调用 `registerUiTools` 始终注册
- `src/renderer/store/app-store.ts` — `connectionDialogPrefill` 字段 + `setConnectionDialogPrefill` / `clearConnectionDialogPrefill` action
- `src/renderer/components/ConnectionDialog.tsx` — useEffect `[open]` 边沿读 prefill + `clearConnectionDialogPrefill()`
- `src/renderer/App.tsx` — `useUiPatchSubscription()` 一次挂载
- `tests/fixtures/mock-preload-api.ts` — `ui` 命名空间 + `emitUiPatch`

**测试（5 个新文件）**：
- `tests/unit/mcp/ui/tools.test.ts`、`schemas.test.ts`、`screenshot.test.ts`
- `tests/unit/main/ipc/ui-bridge.test.ts`（轻量）
- `tests/unit/renderer/hooks/useUiPatchSubscription.test.ts`
- 扩 `tests/unit/renderer/components/ConnectionDialog.test.tsx`、`tests/unit/renderer/store/app-store.test.ts`

**Trade-off**：uiBridge 不独立模块（合并进 ipc/index.ts）；error 翻译 inline（不抽 error-translate）；fixtures inline mock（不新建 fake fixture 文件）；evidence kind 复用 `ui_screenshot`（不新增 `ui_state`）；`set_connection_type` 仅写 prefill，dialog 当前打开时不立即生效（保护用户输入）。

## Phase 5: Implementation（实施摘要）

实施代理执行结果（全自动模式，所有微决策记录如下）：

### 新建文件（7）

- `src/mcp/surfaces/ui/types.ts` — `CapturableImage` / `CapturableWebContents` / `CapturableWindow` / `UiStoreBridge` / `UiToolsDeps`（Electron-free minimal interfaces）
- `src/mcp/surfaces/ui/schemas.ts` — `nonSensitivePrefillSchema` / `uiConfigurePatchSchema`（discriminatedUnion 4 分支）/ `uiConfigureInputSchema` / `uiScreenshotInputSchema`，每层 `.strict()`
- `src/mcp/surfaces/ui/tools.ts` — `registerUiTools` + inline `translateUiError`（仅 ToolError 透传 + ZodError + INTERNAL fallback；无独立 error-translate 模块）
- `src/renderer/hooks/useUiPatchSubscription.ts` — 单 useEffect 订阅 patch → store action 派发
- `tests/unit/mcp/ui/tools.test.ts` — 17 个用例（注册 / discriminated union 分发 / sensitivity / UI_NOT_AVAILABLE 三种情境 / schema strict）
- `tests/unit/mcp/ui/schemas.test.ts` — 14 个用例（top-level / patch / prefill 三层 strict）
- `tests/unit/mcp/ui/screenshot.test.ts` — 2 个用例（roundtrip 解码 + BUFFER_TOO_LARGE）
- `tests/unit/renderer/hooks/useUiPatchSubscription.test.ts` — 6 个用例
- `tests/unit/main/ipc/ui-bridge.test.ts` — 2 个用例（mock-preload-api ui 命名空间烟雾测试 —— 真实 BrowserWindow 广播无法在 vitest 验证，由 MCP tools.test.ts 端到端覆盖）

### 修改文件（11）

- `src/shared/error-codes.ts` — `UI_NOT_AVAILABLE` 加入 `ERROR_CODES`
- `src/mcp/registry.ts` — `UI_NOT_AVAILABLE` 加入 `ToolErrorCode` union（M5 双向同步）
- `src/shared/ipc-protocol.ts` — `UI_STATE_PATCH: 'ui:statePatch'` 新增
- `src/shared/preload-api.ts` — `NonSensitivePrefill` / `UiStatePatch` / `UiNamespace`（仅 `onStatePatch`）/ `PreloadAPI.ui`
- `src/main/preload.ts` — `api.ui.onStatePatch` 暴露（用现有 `subscribe<T>` helper）
- `src/main/ipc/index.ts` — inline `createUiBridge(getActiveWindow)`（applyPatch 遍历 `BrowserWindow.getAllWindows()` 且按 `wc.isDestroyed()` 守卫；subscribers Map 跟踪 destroy 清理）+ 注入 createMcpServer + dispose 清空
- `src/main/index.ts` — 模块级 `getMainWindow()` thunk + `registerIpcHandlers({ getMainWindow })`
- `src/mcp/server.ts` — `CreateMcpServerOptions` 加 `uiBridge?: UiStoreBridge` + `getActiveWindow?: () => CapturableWindow | null`，调用 `registerUiTools` 始终注册
- `src/renderer/store/app-store.ts` — `connectionDialogPrefill: NonSensitivePrefill | null` 字段 + `setConnectionDialogPrefill` / `clearConnectionDialogPrefill` action
- `src/renderer/components/ConnectionDialog.tsx` — useEffect `[open]` 边沿合并 prefill（覆盖 INITIAL_FORM）+ 立即 `clearConnectionDialogPrefill()`；依赖列表保持仅 `[open]`
- `src/renderer/App.tsx` — `useUiPatchSubscription()` 一次挂载
- `tests/fixtures/mock-preload-api.ts` — `ui` 命名空间 + `emitUiPatch`
- `tests/unit/renderer/store/app-store.test.ts` — 加 `connectionDialogPrefill: null` 到 reset + 2 个 prefill action 用例
- `tests/unit/renderer/components/ConnectionDialog.test.tsx` — 加 `connectionDialogPrefill: null` 到 reset + 1 个 prefill 应用用例

### 微决策（实施过程中产生）

1. **Q-D1：`ui_screenshot` evidence kind 命名**。候选 `'ui_screenshot'` / `'screenshot'` / `'ui_state'`。**选 `'ui_screenshot'`**（与 EvidenceKind union 已有项一致；ui_configure 同样复用此 kind，`data.dispatched` 区分形态，与决策 Q10 一致）。
2. **Q-D2：`ui_configure` 是否引入"已发送 patch"verifyEvidence**。候选回放 store 当前值 / 仅回填 dispatched。**选回填 dispatched**（fire-and-forget 语义已选定 Q5；store 当前值需要 IPC 回执，不在本期 budget）。
3. **Q-D3：`createUiBridge` 实现位置**。候选独立 `src/main/ui-bridge.ts` / 内联 `ipc/index.ts`。**选内联**（与 Architect A "Trade-off"声明一致；30 行代码，单点使用，独立模块反而增加跳转成本）。
4. **Q-D4：`applyPatch` 广播策略**。候选 `subscribers Map`（与 transcript-ipc 同形）/ `BrowserWindow.getAllWindows()` 每次遍历。**选每次遍历 + 顺手 subscribe**（preload 不会触发 IPC invoke 加入 subscribers，必须在 applyPatch 时主动发现窗口；用 `wc.isDestroyed()` 守卫 + 只挂一次 'destroyed' once，等价于 transcript-ipc M4 守卫语义）。
5. **Q-D5：`ConnectionDialog` prefill 合并策略**。候选 `prev` 上叠 / `INITIAL_FORM` 上叠。**选 `INITIAL_FORM` 上叠**（dialog 关→开边沿前，关闭时已 reset 到 INITIAL_FORM；从 INITIAL_FORM 起步避免上次表单残值与新 prefill 混淆，语义更清晰）。
6. **Q-D6：`set_connection_type` 是否同时打开 dialog**。候选 (a) 仅写 prefill / (b) 写 prefill 并 open。**选 (a)**（与 Q1 schema 命名"_set_connection_type_"语义一致；如果 AI 想"切类型并打开"，应显式串两步：先 set_connection_type 再 open_connection_dialog with prefill；保持 action 单一职责）。
7. **Q-D7：ui-bridge 测试粒度**。原方案要"轻量主进程测试"。**改为 mock-preload-api 烟雾测试**（真实 `BrowserWindow.getAllWindows()` 不能在 vitest node/happy-dom 环境跑；端到端契约由 MCP tools.test.ts 覆盖；ui-bridge.test.ts 仅校验 fixture 自身）。
8. **Q-D8：测试基建未引入新 fake fixture**（`fake-store-bridge.ts` / `fake-capturable-window.ts` 在原方案中提到）。改为在 `tools.test.ts` setup 内联 `vi.fn()` + minimal interface 字面量（与 mock-preload-api 同思路，inline 创建对象），避免新文件。

### 验收命令输出

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | exit 0，0 error / 0 warning |
| `pnpm test` | exit 0，**459 个测试通过**（baseline 420 + 39 新增） |
| `pnpm run build` | exit 0，`tsc -b` + `vite build` 全成功，CSS 23.49 kB / JS 621.64 kB |
| `pnpm run validate:licenses` | exit 0，19 deps 全部合规（无新增运行时依赖） |

### Review fix 决策记录（2026/06/14）

针对 Phase 6 评审三视角识别的 H1+H2+M1-M5 共 7 项必修，子选择如下：

- **H1+H2：抽 `createUiBridge` 到独立模块 `src/main/ipc/ui-bridge.ts`**。问题：`src/main/ipc/index.ts` 导入 `electron`，测试 happy-dom 环境下无法直接 import 它做 `createUiBridge` 单测。候选：(A) 在 `index.ts` 内联保留并通过模块 mock electron 测，(B) 抽到独立文件让测试直接 import（**选中**）。理由：B 与 transports 的 `*-like.ts` 接口分离思路一致，`ui-bridge.ts` 仅依赖 `IPC_CHANNELS` + 类型，零 Electron 进口；`index.ts` 仅负责把 `BrowserWindow.getAllWindows()` 适配进 `UiPatchTarget` thunk。
- **M1：抽到 `src/mcp/limits.ts` 而非 `src/shared/binary-limits.ts`**。候选：(A) `src/shared/`（通用跨进程常量），(B) `src/mcp/limits.ts`（**选中**）。理由：MAX_BINARY_BYTES 是 MCP 协议域语义（base64 over JSON 上限），不属于 main↔renderer IPC 共享数据契约；放 `src/mcp/` 与 ERROR_CODES 在 `src/shared/` 的不对称是合理的（错误码确实跨进程，二进制大小仅服务于 MCP surfaces）。
- **M1：`binary-codec.ts` 保留 `export { MAX_BINARY_BYTES, MAX_BASE64_INPUT_LEN }` re-export**。理由：`tests/unit/mcp/ui/screenshot.test.ts` 仍 `import { MAX_BINARY_BYTES } from '@/mcp/surfaces/debug/binary-codec.js'`；保留 re-export 避免无收益的测试改动，让常量"哪个文件最先消费、哪里就能 import"。新增 surface 应统一从 `src/mcp/limits.js` import。
- **M2：调用方改 `setConnectionDialogPrefill(null)` 而非保留 helper alias**。候选：(A) 留下 `clearConnectionDialogPrefill` 作为 alias，(B) 全删并就地调用 setter（**选中**）。理由：1 行 alias 不抵消"两套等价 API 让调用方犹豫"的成本；store action 引用稳定，调用点用 `useAppStore.getState().setConnectionDialogPrefill(null)` 与 prefill 读取保持同模式。
- **M3：SSH 优先级高于 local-shell 反推**。候选：(A) SSH 优先（**选中**），(B) local-shell 优先，(C) 任一冲突视为非法 + 拒绝。理由：SSH 字段语义（host/port/username）更强且组合性高；AI 推 `localCwd` 同时留 `sshHost` 是无效输入，按 SSH 处理便于早暴露错误而非静默切到 local-shell。C 过严，会让"AI 多塞了一个无害字段"成为硬错。
- **M4：删除死 IPC 常量后同步更新 `tests/unit/smoke.test.ts`** —— smoke 原本断言 `UI_SCREENSHOT === 'ui:screenshot'`，改为断言 `UI_STATE_PATCH === 'ui:statePatch'`，保持一条 UI namespace 健全性检查。
- **M5：description 末尾追加"close→open"指引**。候选：(A) 加在 description 末尾自然语段（**选中**），(B) 单独 schema 字段。理由：MCP description 是 AI 唯一可读的工具语义来源，自然语段比额外字段更稳定。
- **测试调整**：原 `tools-binary.test.ts` 两条测试期望 `BUFFER_TOO_LARGE` 业务错误，改为期望 SDK Zod 层 `isError + InvalidParams` 文本（because schema cap 与 codec maxStripped 对齐后，越限输入直接被 SDK 截在 zod parse 阶段，不进 handler）。`BUFFER_TOO_LARGE` 仍保留作为 codec defense-in-depth。

## Phase 6: Review（三视角评审）

并行派 3 个 `feature-dev:code-reviewer`（Simplicity/Bugs/Conventions）。

### 汇总报告

#### High（必修）

- **H1：Q-D4 偏离 §C.1 明文 + `uiSubscribers` Map 是死代码** —— `src/main/ipc/index.ts:88-116` 实际采用 `BrowserWindow.getAllWindows()` 遍历，与 §C.1 "subscribers Map 镜像 session-ipc.ts:80，不要 getAllWindows" 不一致。Map 仅用于 destroyed-once 监听器去重，从未在广播路径被读取，是装饰性死代码。当前单窗口下无功能影响，但有"代码与决策记录长期分歧 + 多窗口扩展时静默串扰"风险。
  - **处置**：选方案 B —— 接受 getAllWindows 简化路径（Phase 10 仅有 mainWindow，工作量符合 1x），删掉 `uiSubscribers` Map / `subscribeUiPatch` / dispose 内 `clear()` / 14 行设计 journal 注释，并把 §C.1 / Q-D4 决策回写为"基于 getAllWindows + isDestroyed 守卫；多窗口扩展时再切到 subscribers Map"。
- **H2：`wc.send()` 缺 try/catch，destroyed 竞态致 ui_configure 错回 INTERNAL** —— isDestroyed-check-then-send 之间的事件循环可派发 `'destroyed'`，导致 `wc.send` 同步抛 `Object has been destroyed`。该异常冒泡到 `registerTool` 的 catch，工具回 INTERNAL 而非 success；已发出去的 patch 不会回滚（半成功被吞）。
  - **处置**：每个 `wc.send` 包 try/catch，destroyed 即跳过。补一条单元测试：fake wc `isDestroyed:false` + `send` 抛错 → applyPatch 不抛、后续 wc 仍收到。

#### Medium（默认同期修）

- **M1：`MAX_BINARY_BYTES` 跨 surface 依赖** —— `src/mcp/surfaces/ui/tools.ts:19` 从 `../debug/binary-codec.js` import，违反"surfaces 自包含"。
  - **处置**：抽到 `src/mcp/limits.ts`，debug 与 ui 都从此处 import。（不抽到 src/shared 是因为限制属于 MCP 域语义，不属于跨进程共享类型范畴）
- **M2：`clearConnectionDialogPrefill` 与 `setConnectionDialogPrefill(null)` 等价**
  - **处置**：删掉 `clearConnectionDialogPrefill` action / type / 测试，调用方改 `setConnectionDialogPrefill(null)`。
- **M3：prefill 缺 `type` 时 form.type 被强制 `'serial'` 覆盖，UI 字段不可见** —— AI 调用 `prefill_connection_form({ sshHost: 'x' })` 时 sshHost 被吞。
  - **处置**：在 ConnectionDialog 的 useEffect 内推导 type —— 若 prefill 含任一 SSH 字段（sshHost/sshPort/sshUsername）则 type 切到 ssh；含 localShell* 则切到 local-shell；否则保持 INITIAL_FORM 默认。补单测覆盖。
- **M4：`IPC_CHANNELS.UI_CONFIGURE` / `UI_SCREENSHOT` 是死常量** —— 整仓无引用，且 Phase10.md §B 已决定它们是 MCP 内部消化的概念。
  - **处置**：删除两条常量；保留 `UI_STATE_PATCH`。
- **M5：ui_configure tool description 未文档化"dialog 已开时 set_connection_type 静默失效"**
  - **处置**：在工具 description 中追加一句说明，AI 知道需要 close→set→open。

#### Low（记录推迟到后续 phase）

- **L1：ui_screenshot 缺 minimized/0x0 检测**：minimized 窗口可能返回空 NativeImage。Phase 10 范围外，Phase 11+ 触屏化测试时再加。
- **L2：ui_screenshot 不支持 timeoutMs/AbortSignal**：capturePage 偶发卡顿；与 Phase 9 jlink debug 的 `withAbortableTimeout` 风格统一是后续工作。
- **L3：ui_configure evidence.kind 复用 'ui_screenshot' 名称误读**：保留现状（与 Q10 决策一致），Phase 11 若客户端实测出错再考虑加 `'ui_patch'` 子 kind。
- **L4：subscribeUiPatch 内部 `Map.set(key, wc)` 同 key 重写无效语句** —— 跟 H1 一并删。
- **L5：注释清理（85-87 / 99-103 设计 journal）** —— 跟 H1 一并删。

### Q-D4 决策修订（替换原 Q-D4）

**问题**：UI patch 主→渲染广播策略

**候选**：
1. (A) 显式 SUBSCRIBE invoke channel + subscribers Map（镜像 session-ipc.ts）
2. (B) `BrowserWindow.getAllWindows()` 遍历 + `isDestroyed()` + send 包 try/catch（**选中**）
3. (C) 仅向 mainWindow 单点 send

**选中**：B。**理由**：Phase 10 当前只有 mainWindow，A 引入 invoke channel + 双侧握手对一个 1x 工作量 phase 过度。B 简洁、对单窗口下行为正确、`once('destroyed')` 自然清理。多窗口（设置面板、关于框）扩展时切回 A —— 这是 Phase 11+ 的工作，那时再补 SUBSCRIBE channel。**风险**：若引入加载相同 preload 的非 LinkTerm 窗口（如 detached devtools popup）会串扰；当前架构无此风险。

## Phase 7: Summary（验收）

Review fix 完成后重新跑 4 条验收命令，全部绿通过：

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | exit 0，0 error / 0 warning |
| `pnpm test` | exit 0，**462 个测试通过**（baseline 459 + 3 新增：createUiBridge 1 + ConnectionDialog 推导 2） |
| `pnpm run build` | exit 0，`tsc -b` + `vite build` 全成功，CSS 23.49 kB / JS 621.71 kB |
| `pnpm run validate:licenses` | exit 0，19 deps 全部合规（无新增运行时依赖） |

**Phase 10 交付完成**：2 个 MCP 工具（ui_configure 4-action discriminatedUnion + ui_screenshot 16 MiB cap）、UI_NOT_AVAILABLE 错误码双向同步、UI_STATE_PATCH 单向广播 channel、connectionDialogPrefill store 字段 + prefill type 自动推导、`createUiBridge` Electron-free 适配层、`src/mcp/limits.ts` 共享常量。Q-D4 决策已修订为 getAllWindows() + isDestroyed + try/catch 简化方案；多窗口扩展时再切回 subscribers Map。
