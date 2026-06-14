# Phase 9 决策记录 — J-Link MCP Surface

执行日期：2026-06-14
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：实现独立的 J-Link 调试/烧录/RTT/GDB MCP surface，无 backend 时安全拒绝。

### 计划交付物（DEVELOPMENT_PLAN.md §971）

| 文件/模块 | 用途 |
|---|---|
| `src/jlink/types.ts` | IJLinkBackend 接口 |
| `src/jlink/null-backend.ts` | 无 backend 时所有操作返回结构化拒绝 |
| `src/jlink/jlink-adapter.ts` | 具体适配器（初始 stub） |
| `src/mcp/surfaces/debug/` | Debug 工具实现、schema、backend 注册 |

### J-Link 工具清单（计划层）

`probe_detect/connect/disconnect/status`, `cpu_reset/halt/run/step`, `breakpoint_set/clear/list`, `register_read/write/list`, `memory_read/write`, `flash_download/erase/write/verify`, `rtt_connect/read/clear/search`, `gdb_server_start/stop`, `snapshot_capture`, `crash_diagnose`

### 关键架构决策（计划层）

1. **IJLinkBackend 纯接口 + null-backend** — 无 backend 时全部返回 `{ success: false, error: { code: 'NO_BACKEND' } }`
2. **Debug 输出与终端 transcript 隔离** — 使用 EvidenceKind.debug_output
3. **Fatal error 分类** — 退出码 0 但含 fatal marker → 仍分类为失败
4. **jlinkmcp 引用需先许可证审查** — 当前未声明 license，不得复制源码

### 依赖阶段：Phase 4
### 相对工作量：2x（中量）

### 风险登记（DEVELOPMENT_PLAN.md §1102）
- J-Link backend 抽象与实际 API 不匹配 → 从需求定义 IJLinkBackend，不从 jlinkmcp 源码；null-backend 先行

## Phase 2: Exploration（代码库勘探）

2 个并行 `feature-dev:code-explorer`，要点合并：

### MCP 表面注册模式（Explorer A）
- **`createMcpServer` 是单一组合根**；每个 surface 用 `registerXxxTools(server, deps)` 注册，deps 走 typed sub-object（`TerminalToolsDeps` / `WorkspaceToolsDeps` / Phase 9 加 `DebugToolsDeps`）
- **workspace 用的"无依赖即不注册"**对 Phase 9 **不适用**——计划 §986 明确"无 backend 时全部返回 `{ success: false, error: { code: 'NO_BACKEND' } }`"，工具必须始终注册才能让 AI 拿到结构化拒绝；改用"始终注册 + 默认 NullBackend"
- **`NO_BACKEND` 已存在 `ToolErrorCode` union（registry.ts:41），但缺 `ERROR_CODES` 常量**——Phase 9 须双向对齐（M5 风格）
- **`EvidenceKind` 已含 `'debug_output'`**——直接复用，二进制 base64 编码（沿用 `read_from_session` 的 `dataBase64` 字段约定 + `decodeDataPayload` 校验）
- **测试 harness（terminal-tools / workspace-tools）共用 ~50 行模板**：`createInMemoryMcpTransportPair` + `createMcpServer({ ..., transportFactory })` + SDK Client；新建 `tests/fixtures/mock-jlink-backend.ts` 注入即可
- **工具数量**：建议 28 个（10 family），sensitivity 按 read-only / state-affecting 严格分类——错配导致旧 schema 版本绕开 mismatch refuse

### IJLinkBackend 接口形态（Explorer B）
- **抛错而非返回**：与 SerialTransport / SshTransport / WorkspaceConfigManager 一致；MCP 层 `instanceof` 翻译；这样 backend 调用站无需 fork result shape
- **错误层级**（新建 `src/jlink/errors.ts`）：`JLinkError` 基类 + 8 子类（`JLinkNoBackendError` / `ProbeNotFoundError` / `ProbeNotConnectedError` / `BackendBusyError` / `FlashVerifyFailedError` / `RttNotConnectedError` / `GdbPortInUseError` / `OperationFailedError`）
- **probeId 用 UUID v4**（仿 SessionId）；`probeConnect` 唯一 mint 点；adapter `Map<ProbeId, ProbeHandle>`；其他方法首条 `requireProbe(probeId)`
- **memory/flash 用 `Buffer`**；MCP 层 base64 编/解码（与 terminal `dataBase64` 同源）
- **flashDownload/flashVerify** 双分支：`{ binary: Buffer }` 或 `{ path: string }`；Phase 9 schema 仅暴露 binary（path 留 Phase 11+ 渲染端文件上传）
- **AbortSignal 携入**：长操作（flash / gdb start）入参带 `signal?: AbortSignal`，避免后期接口 bump（呼应 Phase 7 backlog）
- **null-backend 显式列出每个方法**（不用 Proxy）—— TS 接口扩展时立即编译报错，不漏方法
- **target 必填**：`probeConnect(opts: { target, ... })` —— J-Link Commander 强制要求 device name；null-backend 也用此参数稳定 reject
- **新增 8 个 ERROR_CODES**：`NO_BACKEND`（双向对齐）+ `PROBE_NOT_FOUND` + `PROBE_NOT_CONNECTED` + `BACKEND_BUSY` + `FLASH_VERIFY_FAILED` + `RTT_NOT_CONNECTED` + `GDB_PORT_IN_USE` + `JLINK_OPERATION_FAILED`
- **Mock backend** 提供 `calls[]` ledger + `failOnce` / `delayMs` 注入点 —— 测试断言"MCP base64 → Buffer 翻译正确"靠这个 ledger

### CLAUDE.md 硬约束（共识）
- `src/jlink/` 与 `src/core/` 同级；同样禁 Electron 直接 import；ESM `.js` 后缀
- jlinkmcp 引用仅设计参考；不复制源码；不引入新 runtime dep（Phase 9 stub + null-backend；真实适配器后续 Phase 落地）
- Memory write / flash write 二进制走 base64，schema 显式校验（不依赖 Buffer.from 的静默丢弃）
- sensitivity 分类影响版本协商：state-affecting 工具 schema mismatch 拒绝；read-only 仅警告

## Phase 3: Clarifying（自动应答）

下表罗列识别到的歧义点、候选项与自动选中（依据：CLAUDE.md 不变量、Phase 2 现状、用户既有偏好）。

| # | 歧义点 | 候选 | 选中 | 理由 |
|---|---|---|---|---|
| Q1 | backend 注入策略 | (a) 始终注册工具 + 默认 NullBackend / (b) 仅在注入真实 backend 时注册（仿 workspace） | **(a) 始终注册 + 默认 NullBackend** | 计划 §986 显式要求"无 backend 时返回 NO_BACKEND"——AI 必须能看到工具并拿到结构化拒绝；workspace 模式让 AI 看到"工具不存在"，违反契约 |
| Q2 | backend 错误处理约定 | (a) throw 域错误 + MCP `instanceof` 翻译 / (b) 返回 `{ success, error }` | **(a) throw 域错误** | 与 SerialTransport / SshTransport / WorkspaceConfigManager 一致；现有 `translate*Error` 模式可复用 |
| Q3 | probeId 形态 | (a) UUID v4（仿 SessionId）/ (b) 硬件 serialNumber / (c) 数字递增 | **(a) UUID v4** | serialNumber 易泄漏（贴在硬件上、有时是 license key）；UUID 间接层让 adapter 自由 remap；与 SessionId 风格一致 |
| Q4 | memoryRead / flash 二进制传输 | (a) `Buffer` 在 backend 层 + base64 在 MCP 层 / (b) base64 全程 | **(a) Buffer @ backend, base64 @ MCP** | 与 terminal `dataBase64` 字段同源；backend 接口 JSON-agnostic，更易模拟硬件操作 |
| Q5 | flashDownload / flashVerify 数据来源 | (a) 仅 `binary: Buffer`（base64 over MCP）/ (b) `binary` 与 `path` 双分支 | **(a) 仅 binary（Phase 9）；types.ts 接口保留 path 分支为 union 但 schema 不暴露** | renderer 文件上传是 Phase 11+ 范畴；Phase 9 仅 MCP 调用，避免服务器端读 caller path 的安全审计负担；接口预留是为避免后期接口 bump |
| Q6 | AbortSignal 透传 | (a) 长操作入参带 `signal?: AbortSignal`（flashDownload / flashVerify / gdbServerStart）/ (b) 不带；调用方拆分超时 | **(a) 长操作带 signal** | 避免后期接口 bump；呼应 Phase 7 backlog（sendAndWait abort 信号语义）；null-backend 不必处理 signal（即时 reject） |
| Q7 | 工具数量边界 | (a) 严格按计划 §982 列表实现（~25 工具）/ (b) 拆分为 28 工具更细粒度（Explorer A 建议） | **(b) 28 工具** | 计划文字"~"暗示可调整；细分为 family 后 sensitivity 分类更准（probe_status read-only / probe_connect state-affecting 不能合并） |
| Q8 | sensitivity 分类红线 | (a) 严格按 mutate semantic 分（read 类一律 read-only，write/run 类一律 state-affecting）/ (b) 视情况 | **(a) 严格按 mutate** | 旧版 schema mismatch 时 read-only 仅警告、state-affecting 拒绝——错配会让旧 AI 客户端绕过 cpu_run 等危险操作的版本拒绝 |
| Q9 | 错误码命名风格 | (a) `J_LINK_*` 前缀 / (b) 不带前缀（PROBE_NOT_FOUND / FLASH_VERIFY_FAILED） | **(b) 不带前缀** | 现有 ERROR_CODES 都不加领域前缀（QUEUE_FULL / SESSION_CLOSED 等）；`JLINK_OPERATION_FAILED` 是唯一例外（避免与未来 OPERATION_FAILED 撞名） |
| Q10 | jlink-adapter.ts 真实程度 | (a) 完整 stub（每方法抛 `JLinkOperationError('not implemented')`）/ (b) 仅类型导出 + 单元测试占位 / (c) 真接 SEGGER J-Link DLL | **(a) 完整 stub** | 计划 §977 说"具体适配器（初始 stub）"；让构造组合根可见的同时不引真实依赖；Phase 13+ 替换实现不动 MCP 层 |
| Q11 | rtt_read 是否返回 cursor | (a) 类似 transcript 的 sequence cursor / (b) backend 自带 channel offset / (c) 无 cursor，每次返回所有可读字节 | **(c) 无 cursor，每次返回 maxBytes 上限内全部字节** | RTT control block 自身是环形 buffer，硬件层已有读指针；引入额外 cursor 会与硬件不一致；backend 把硬件读指针推进，调用方按需轮询 |
| Q12 | snapshot_capture / crash_diagnose 数据形态 | (a) 共用 `data: { pc, sp, registers, ... }` 结构 / (b) 独立结构 | **(b) 独立结构（SnapshotResult / CrashDiagnosis 类型分离）** | snapshot 含 memory snippets（适合下载分析）；crash 含 fault enum + stackTrace（结构化诊断）；硬塞 union 增加客户端解析负担 |
| Q13 | DI 注入位点 | (a) `MainProcessContext.jlinkBackend` 显式 / (b) `CreateMcpServerOptions.jlinkBackend?` 默认 NullBackend | **两者都做：MainProcessContext 持有 + 注入到 createMcpServer** | 与 sessionManager / workspaceConfigManager 模式一致；析构钩子统一 |
| Q14 | 测试是否启动真实 J-Link | (a) MockJLinkBackend + MCP 层端到端 / (b) 仅 MockJLinkBackend 单测 + null-backend 集成 | **(a) MockJLinkBackend + MCP 端到端 + NullBackend 单测** | Phase 9 不含真实 J-Link；端到端覆盖 base64↔Buffer 翻译这一关键耦合点；NullBackend 全方法 reject 单测确保契约 |
| Q15 | flash 二进制最大尺寸 | (a) MCP schema 限 16 MiB（base64 后 ~21 MiB）/ (b) 不限 / (c) 仿 workspace `1 MiB` | **(a) 16 MiB 上限** | Cortex-M flash 一般 ≤ 4 MiB，16 MiB 留 4× 余量；防 MCP JSON 消息溢出（protocol 默认无硬限但客户端通常 32 MiB）；schema 层 `.refine` 校验 |

不向用户反问。所有选择已记录。

## Phase 4: Architecture（候选 + 选中）

3 个并行 `feature-dev:code-architect`。

### 方案 A — Minimal Changes
- 9 个新文件（5 src + 4 test）+ 4 修改；单 `tools.ts`（28 handlers + translateJLinkError 内联）；types.ts 含 interface + 9 错误类
- 利：surface 最小，PR 短；reuse `registerTool` / `ToolError` 模式 verbatim；无新抽象
- 弊：`tools.ts` 600-800 行（28 个 handler），grep 跨翻；types.ts 混 interface+errors 关注点；base64 codec 散在 28 处难审计

### 方案 B — Clean Architecture
- ~38 个文件（30 新 + 8 修）；10 sub-interface（IProbeBackend / ICpuBackend ...）union 组合；ProbeRegistry 独立类；families/×9 stub；surfaces/debug/×9 family + 5 cross-cutting；sensitivity-table SSOT
- 利：测试隔离极强；Phase 13 真实 adapter 可逐 family 实现；single-responsibility 极致；error-translator 与 sensitivity-table 单独可审计
- 弊：30 文件 PR 体积巨大；跨切修改需触 3 层；composite intersection 类型让 partial backend "类型正确但语义未实现"——实际 mock divergence 风险高

### 方案 C — Pragmatic Balance ⭐ 选中
- ~14 个文件（10 src + 4 test + 1 fixture）+ 3 修改
- `src/jlink/`：4 文件（types / errors / null-backend / jlink-adapter）+ index 桶；errors 独立文件因 translate helper instanceof 它们 + tests 按类断言
- `src/mcp/surfaces/debug/`：5 文件（schemas / tools / tools-binary / error-translate / binary-codec）；tools 拆 binary vs non-binary——base64 codec 边界集中在 2 文件
- 单一 IJLinkBackend interface（不拆 sub-interface）；JLinkAdapter 内部 Map<probeId, ProbeHandle>，probeId 用 `crypto.randomUUID()`；探针 lifecycle（connect/disconnect/status）真实实现，其他方法抛 `NOT_IMPLEMENTED`
- 总是注册 28 工具；默认 NullBackend，per-tool 抛 `NoBackendError`
- AbortSignal last-param；timeoutMs 走 schema 顶层 `abortableMixin`
- 8 新 ERROR_CODES：`NO_BACKEND` / `PROBE_NOT_FOUND` / `PROBE_BUSY` / `JLINK_OPERATION_FAILED` / `BUFFER_TOO_LARGE` / `ABORTED` / `INVALID_STATE` / `NOT_IMPLEMENTED`
- `JLinkOperationError`（计划名 `JLinkOperationFailedError` 在实现时被缩短；ERROR_CODES key `JLINK_OPERATION_FAILED` 不变）

### 选中理由
1. **未违反 CLAUDE.md 不变量**：`src/jlink/` 零 Electron；ESM `.js` 后缀；新错误码同步 ERROR_CODES + ToolErrorCode 双向；MCP `origin:'ai'` 由 registry 强制；不复制 jlinkmcp 源码
2. **工作量匹配**：DEVELOPMENT_PLAN.md 标记 2x（中量）；按 next-phase.md 规则 1.5x ≤ X ≤ 3x 默认 Pragmatic
3. **拒方案 A**：单 tools.ts 600-800 行 + 28 handler 内联 base64 → 安全审计与未来重构成本高；types.ts 混合关注点
4. **拒方案 B**：sub-interface 组合让 partial backend 类型正确语义未实现，mock divergence 风险高；30 文件 PR 体积超过本期价值；ProbeRegistry 独立类提前抽象（Phase 9 仅 1 实现，YAGNI）；family×9 拆分在 Phase 13 真实接 backend 时大概率被推翻
5. **C 的取舍恰好中庸**：base64 codec 与 error-translate 抽出（A 没有，可审计性提升明显），但不拆 family（B 过早抽象）；`tools.ts` ~600 行是 honest trade-off（仍然可读）

### Phase 5 实施计划（按选中方案）

按文件依赖序列执行：
1. `src/shared/error-codes.ts` + `src/mcp/registry.ts` 加 8 个错误码
2. `src/jlink/types.ts`（IJLinkBackend + DTOs）
3. `src/jlink/errors.ts`（JLinkError 基类 + 8 子类）
4. `src/jlink/null-backend.ts`（每方法抛 NoBackendError）
5. `src/jlink/jlink-adapter.ts`（probe lifecycle 真；其他抛 NOT_IMPLEMENTED）
6. `src/jlink/index.ts`（桶）
7. `src/mcp/surfaces/debug/binary-codec.ts` + `error-translate.ts`
8. `src/mcp/surfaces/debug/schemas.ts`
9. `tests/fixtures/fake-jlink-backend.ts`
10. `src/mcp/surfaces/debug/tools.ts`（19 非二进制）
11. `src/mcp/surfaces/debug/tools-binary.ts`（9 二进制）
12. `src/mcp/server.ts` + `src/main/ipc/index.ts` 注入
13. 4 个测试文件（null-backend / adapter / tools / tools-binary）

## Phase 5: Implementation（实施摘要）

执行人：`backend-developer` sub-agent。一次性按 13 步序列落地（含与计划的微调）。

### 创建的文件（16 个）

**`src/jlink/`（5）**：
- `types.ts` — `IJLinkBackend`（28 方法）+ 9 DTOs（ProbeInfo / ProbeConnectOptions / BreakpointSpec / MemoryRange / RegisterValue / RttChannelInfo / RttReadResult / FlashDownloadOptions / GdbServerHandle / SnapshotResult / CrashDiagnosis）
- `errors.ts` — `JLinkError` 基类（用 `new.target.name` 让 8 子类不必各自 this.name = ...）+ 8 子类
- `null-backend.ts` — `NullJLinkBackend`，每方法显式 `throw new NoBackendError()`（不用 Proxy，确保 TS 接口扩展立即报错）
- `jlink-adapter.ts` — probe lifecycle 真实（`Map<probeId, ProbeHandle>` + `crypto.randomUUID()`）；其他方法 `requireProbe(probeId)` 后抛 `JLinkNotImplementedError`
- `index.ts` — 桶导出

**`src/mcp/surfaces/debug/`（5）**：
- `schemas.ts` — 28 Zod schemas，全部 `.strict()`；共享 `commonSchema` / `probeIdField` / `abortableMixin` / `base64Field`（带 `.max(MAX_BASE64_INPUT_LEN)` 上限）
- `binary-codec.ts` — `decodeBase64Capped`（先按 stripped 长度短路，再 `Buffer.from`）；`MAX_BINARY_BYTES = 16 MiB`；空白/空载荷拒绝
- `error-translate.ts` — `translateJLinkError`（instanceof 链）+ `runJLink<T>` 包装 + `withAbortableTimeout`（Phase 5 评审后从独立文件 fold 进来）+ `ok` helper
- `tools.ts` — 20 非二进制工具（probe×4、cpu×4、breakpoint×3、register×3、gdb×2、diagnostic×1、flash_erase、rtt_connect、rtt_clear）
- `tools-binary.ts` — 8 二进制工具（memory_read / memory_write / flash_download / flash_write / flash_verify / rtt_read / rtt_search / snapshot_capture，因 SnapshotResult.memorySnippets 含 Buffer）

**测试 + fixture（5）**：
- `tests/fixtures/fake-jlink-backend.ts` — `FakeJLinkBackend` + `calls[]` ledger + `failOnce` / `delayMs` 注入；用 `@/jlink/...` 别名导入，与 mock-{serialport,pty,ssh}.ts 一致
- `tests/unit/jlink/null-backend.test.ts` — 28 方法循环断言全部 NoBackendError
- `tests/unit/jlink/jlink-adapter.test.ts` — probe lifecycle、UUID mint、ProbeNotFoundError、NOT_IMPLEMENTED 覆盖
- `tests/unit/mcp/debug/tools.test.ts` — 28 工具注册、敏感度、NO_BACKEND 默认、roundtrip
- `tests/unit/mcp/debug/tools-binary.test.ts` — base64↔Buffer、AbortSignal、BUFFER_TOO_LARGE 预检查、空白载荷、`.strict()` 拒未知字段

### 修改的文件（4）

- `src/shared/error-codes.ts` — +8 codes（NO_BACKEND / PROBE_NOT_FOUND / PROBE_BUSY / JLINK_OPERATION_FAILED / BUFFER_TOO_LARGE / ABORTED / INVALID_STATE / NOT_IMPLEMENTED）
- `src/mcp/registry.ts` — `ToolErrorCode` union +6（NO_BACKEND / NOT_IMPLEMENTED 已存在）
- `src/mcp/server.ts` — `CreateMcpServerOptions.jlinkBackend?: IJLinkBackend`，**始终注册** debug 工具（缺省 `new NullJLinkBackend()`）
- `src/main/ipc/index.ts` — `MainProcessContext.jlinkBackend = new JLinkAdapter()`；注入 createMcpServer

### 计划与实现的差异

1. **工具拆分 19/9 → 20/8**：`flash_erase` 无二进制走 tools.ts；`snapshot_capture` 因含 Buffer 走 tools-binary.ts。28 总数不变。
2. **`abortable.ts` → fold 进 `error-translate.ts`**（评审 L3-simplicity）：单函数文件不挣钱。
3. **`encodeBase64` 删除内联**（评审 L1-simplicity）：`buf.toString('base64')` 在 4 处直接调用。
4. **错误类命名 `JLinkOperationFailedError` → `JLinkOperationError`**：实现期缩写；ERROR_CODES 键 `JLINK_OPERATION_FAILED` 不变；本文档 Phase 2 已校对。

## Phase 6: Review（三视角评审）

3 个并行 `feature-dev:code-reviewer`（Simplicity / Bugs / Conventions），合并：1 HIGH + 6 MEDIUM + 8 LOW。一次性 backend-developer 修复了 H1 + 全部 M + 大部分 L。

### Reviewer 摘要

| 视角 | C / H / M / L |
|---|---|
| Simplicity | 0 / 0 / 2 / 4 |
| Bugs/Security | 0 / 1 / 3 / 2 |
| Conventions | 0 / 0 / 1 / 3 |

### 修复处置表（按严重度）

| ID | 来源 | 处置 | 落地位置 |
|---|---|---|---|
| H1 | Bugs | ✅ 修 | `binary-codec.ts` 在 stripped 长度阶段短路（不再 `Buffer.from` 后才量），`schemas.ts` `base64Field.max(MAX_BASE64_INPUT_LEN)` 双重上限；新测试覆盖大载荷预检查 + 空白载荷拒绝 |
| M1 (Bugs) | Bugs | ✅ 修 | 空白/空 base64 → INVALID_ARGUMENT（同 H1 修复点） |
| M2 (Bugs) | Bugs | ✅ 修 | `tools.ts` 加 `sanitizeProbeForMcp` helper（剥 serialNumber）；probe_detect / probe_connect / probe_status 全部经过；新隐私测试 |
| M3 (Bugs) | Bugs | 🟢 仅注释 | gdb_server_start 当前仅 echo caller 输入（Phase 9 stub），Phase 13+ 真实接 backend 时再评估 |
| M1 (Simpl) | Simplicity | ✅ 修 | `ProbeHandle` 删除 interface / speedKHz / connectedAt 三个 dead 字段（注释延期到 Phase 13） |
| M2 (Simpl) | Simplicity | ✅ 修 | `ProbeInfo` 删除 modelName / firmwareVersion |
| M1 (Conv) | Conventions | ✅ 修 | `tests/fixtures/fake-jlink-backend.ts` 改用 `@/jlink/...` 与同目录 fixtures 一致 |
| L1 (Simpl) | Simplicity | ✅ 修 | 删除 `encodeBase64`，4 处内联 |
| L2 (Simpl) | Simplicity | ✅ 修 | `ok` helper 移到 `error-translate.ts`，两处共用 |
| L3 (Simpl) | Simplicity | ✅ 修 | `abortable.ts` fold 进 `error-translate.ts`，文件删除 |
| L4 (Simpl) | Simplicity | ✅ 修 | `JLinkInvalidStateError.actual` 简化（typeof 检查后无需再 String 兜底） |
| L1 (Bugs/Conv) | Conv/Bugs | ✅ 修 | 28 schemas 全部 `.strict()`；嵌套 `ranges[]` 拒未知字段测试 |
| L2 (Bugs) | Bugs | 🟢 仅注释 | withAbortableTimeout 完成-时-超时争用：cosmetic |
| L2 (Conv) | Conventions | 🟢 仅注释 | `JLinkError` 基类 `new.target.name` 模式加注释 |
| L3 (Conv) | Conventions | ✅ 修 | 本文档（Phase9.md Q10 + Phase 4）补齐 `JLinkOperationError` 命名说明 |

## Phase 7: Summary（验收）

### 4 闸门（修复后再验）

```
pnpm run lint               → 0 errors / 0 warnings
pnpm test                   → 37 files / 420 tests pass
pnpm run build              → tsc -b ✓ + vite build ✓
pnpm run validate:licenses  → 19 deps PASS
```

测试增量：363 → **420**（+57）。

### 关键决策（最终落点）

1. **始终注册 + 默认 NullBackend**（Q1）：合规 §4.6 — 无 backend 时所有 28 工具仍可见，回 `NO_BACKEND` 结构化拒绝
2. **Throw 域错误 + MCP `instanceof` 翻译**（Q2）：与 SerialTransport / SshTransport / WorkspaceConfigManager 一致
3. **probeId = UUID v4**（Q3）：serialNumber 不上 MCP 边界；MCP 层 `sanitizeProbeForMcp` 剥除（Phase 6 评审 M2 加固）
4. **Buffer @ backend, base64 @ MCP**（Q4）；**16 MiB 上限 + 输入长度预检查**（Q15 + Phase 6 H1 加固）
5. **AbortSignal 长操作携入**（Q6）：flashDownload / flashVerify / gdbServerStart；`withAbortableTimeout` 集中处理
6. **Sensitivity 严格按 mutate 分**（Q8）：read-only=9 / state-affecting=19；rtt_read 因推进硬件指针归 state-affecting
7. **Adapter stub**（Q10）：probe lifecycle 真，其他 NOT_IMPLEMENTED；Phase 13+ 替换实现不动 MCP 层
8. **`.strict()` 全 28 schemas**：Phase 6 评审采纳
9. **Bidirectional ERROR_CODES + ToolErrorCode 同步**：M5 模式延续

### 给后续阶段的 backlog

- Phase 13（J-Link 真适配器接入）：替换 `JLinkAdapter` 内 `requireProbe` 之外的所有 NOT_IMPLEMENTED 实现；不必触 MCP 层
- gdb_server_start 真实绑定时评估 host 回显语义（评审 M3-bugs）
- 若未来加 RTT log path / J-Link license 等敏感字段，复用 `sanitizeProbeForMcp` 模式扩展
- AbortSignal 完成-时-超时争用：当前 cosmetic；真 backend 协作取消后再观察
