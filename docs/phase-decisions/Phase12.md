# Phase 12 决策记录 — 集成测试 + 收尾

执行日期：2026-06-14
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：端到端集成、边界场景覆盖、错误恢复、性能验证、生产就绪。这是 LinkTerm v2 13 个 Phase 的最后一个收尾 Phase。

### 边界场景覆盖（需求文档第 6 节）

| # | 场景 | 测试位置 |
|---|---|---|
| 1 | 串口连接但无数据 | `tests/integration/serial-no-data` |
| 2 | 自动发现为空，手动输入 | `tests/integration/serial-manual-entry` |
| 3 | 串口热插拔 | `tests/integration/serial-hotplug` |
| 4 | 普通模式半包/二进制数据 | `tests/integration/serial-binary-data` |
| 5 | 终端模式超时不切换模式 | `tests/integration/send-and-wait-timeout` |
| 6 | SSH 字段未填切换类型 | `tests/integration/connection-type-switch` |
| 7 | 命令回显后输出结果 | `tests/integration/echo-then-result` |
| 8 | 工作区配置版本过旧 | `tests/integration/workspace-version-migration` |
| 9 | 高影响操作缺确认 | `tests/integration/high-impact-confirmation` |

### 性能测试

- TranscriptBuffer 100k+ 事件
- WriteQueue 并发负载
- xterm.js 快速输出渲染（仅 hooks 层，不触发真实 DOM）

### 验收标准

- 所有边界场景测试通过
- `npm test` < 30s（unit）/ < 2min（integration）
- `npm run build && npm run validate:licenses` 通过
- 无需 Qt、硬件即可完成验收

### 相对工作量：2x

## Phase 2: Exploration（代码库勘探）

### A. 现有 integration 基建

- `tests/integration/` 当前只有 2 个文件：`ai-human-coop.test.ts`（Phase 5）+ `send-and-wait.test.ts`（Phase 7）
- 7 个 fixtures 齐全（mock-transport / mock-serialport / mock-ssh / mock-pty / fake-jlink-backend / mock-mcp-transport / mock-preload-api），factory 都用 `queueMicrotask` 异步驱动
- `vitest.config.ts` **无 unit/integration 分组**，无全局 timeout，单文件用 `{ timeout }` 自管
- happy-dom 切换通过文件首行 `// @vitest-environment happy-dom`；当前所有 integration 都是 node 环境

### B. 9 个边界场景覆盖现状

| # | 场景 | 状态 | 落点 |
|---|---|---|---|
| 1 | 串口连接但无数据 | 🟨 间接 | `serial-session.test.ts:28`，缺专用断言 |
| 2 | 自动发现为空，手动输入 | 🟨 间接 | discovery=[] 已测，缺端到端 session:create |
| 3 | 串口热插拔 | ✅ | `serial-transport.test.ts:129/166` + `serial-session.test.ts:64` |
| 4 | 半包/二进制 fallback | ✅ | `send-and-wait.test.ts:270` |
| 5 | sendAndWait 超时不切模式 | ✅ | `send-and-wait.test.ts:114` + integration |
| 6 | SSH 字段未填切换类型 | ❌ | renderer 行为完全无测 |
| 7 | 命令回显抑制 | ✅ | `echo-handler.test.ts` 10 用例 |
| 8 | 工作区配置版本过旧 | ✅ | `workspace-config-manager.test.ts:288` |
| 9 | 高影响操作缺确认 | ❌ | **缺功能** — flash_*/cpu_reset 没 `confirm` 字段 |

### C. 性能与容量基建

- `TranscriptBuffer` 上限 `MAX_TRANSCRIPT_EVENTS = 100_000`（`src/shared/constants.ts:20`），`readSince` 越界返回 `truncated:true + oldestAvailableSequence`
- `WriteQueue` `maxDepth=1024`，`'high'` 豁免，`QUEUE_FULL` 同步 reject；`ai-human-coop.test.ts:345` 已验高优先级抢占
- 当前**无任何 perf/benchmark 文件**

### D. Phase 12 核心 gap

- **场景 9 是新增功能**（非纯测试）：需给 `flash_download` / `flash_erase` / `flash_write` / `cpu_reset` 等高影响 MCP 工具增加 `confirm: z.literal(true)` 字段
- **场景 6 是缺测**：ConnectionDialog 类型切换的 happy-dom 单测
- **场景 1/2 加专用断言**：补 integration 测试坐实"无数据"和"空发现+手动输入"路径
- **性能基线**：补 1-2 个 perf 测试（TranscriptBuffer 100k 事件 + WriteQueue 高负载）

## Phase 3: Clarifying（自动应答）

### Q1：场景 9 的 `confirm` 字段是否在本 Phase 引入

**候选**：(a) 引入 (b) 推迟到未来安全审计 Phase
**选 (a)**。**理由**：DEVELOPMENT_PLAN.md 验收标准明文要求"所有边界场景测试通过"且场景 9 在表里；推迟会让 Phase 12 不能 ✅ 收尾。

### Q2：哪些 MCP 工具需要 `confirm` 闸门

**候选**：
1. 仅 `flash_download` / `flash_write` / `flash_erase`
2. 候选 1 + `cpu_reset` / `gdb_server_start`
3. 全部状态修改类（19 个）

**选 2**。**理由**：
- flash 类直接改 ROM，最高风险
- `cpu_reset` 让程序丢上下文，应当确认
- `gdb_server_start` 暴露 TCP 端口，应当确认
- 全部 19 个会让 AI 客户端用起来过于繁琐；run/connect 等纯 lifecycle 不需要

最终 5 个：`flash_download`、`flash_write`、`flash_erase`、`cpu_reset`、`gdb_server_start`。

### Q3：confirm 缺失的错误码

**候选**：(a) 复用 `INVALID_ARGUMENT` (b) 引入新 `CONFIRMATION_REQUIRED`
**选 (b)**。**理由**：
- 与 `WORKSPACE_*` 错误码一样，专用错误码让 AI 客户端可以编程化区分"参数错"vs"需要二次确认"
- 同步双向（`ERROR_CODES` + `ToolErrorCode`），符合 M5 dual-sync pattern
- `confirm: z.literal(true)` 的 zod 错误本身会变成 `INVALID_ARGUMENT`，需要在 schema 把 confirm 设为 `z.boolean().optional()` 让其能进 tools.ts 然后由 tools.ts 显式 throw `ConfirmationRequiredError`

### Q4：confirm 字段的 schema 位置和默认值

**候选**：(a) 每个工具单独加 `confirm: z.boolean().default(false)` (b) 抽 `withConfirm()` 高阶 schema 包装
**选 (a)**。**理由**：5 个工具 + 字段简单（一个布尔）+ 与现有 schema 风格一致；抽包装会徒增间接层。

### Q5：性能测试组织

**候选**：(a) `tests/perf/*.test.ts` 独立目录 (b) `tests/integration/perf-*.test.ts` 同目录 (c) inline 在相关 unit 测试

**选 (b)**。**理由**：
- Phase 12 不引入 vitest 分组（避免动 vitest.config.ts 影响其它 PR）
- `tests/perf/` 让人误以为有分组配置
- `tests/integration/perf-transcript-buffer.test.ts` + `perf-write-queue.test.ts` 与现有 integration 风格一致，单文件 `{ timeout: 30_000 }` 自管

### Q6：边界测试文件命名

**候选**：(a) `scenario-N-xxx.test.ts` (b) 主题命名 `serial-no-data.test.ts`

**选 (b)**。**理由**：DEVELOPMENT_PLAN.md 表里给的"测试位置"列就是主题命名（`integration/serial-no-data` 等），保持一致。

### Q7：场景 1/2/3-8 已覆盖的，是否仍补 integration 文件

**候选**：(a) 全补，凑齐 9 个文件 (b) 仅补 1/2/6/9 缺的，3/4/5/7/8 不重复
**选 (b)**。**理由**：
- 重复测试浪费跑时
- 决策记录里可以列"哪个场景由哪个现有测试已覆盖"作为追溯
- 与 CLAUDE.md "不写多余抽象/不重复"风格一致

最终 Phase 12 新增 4 个 integration 文件（场景 1/2/6/9）+ 2 个 perf 文件 = 6 个新文件。

### Q8：ConnectionDialog 类型切换的字段保留行为（场景 6）

**候选**：(a) 切换时清空对应类型字段 (b) 保留所有字段（用户切回后恢复）

读 explorer 报告：当前实现是 (b) — `update('type', ...)` 仅改 `type`，SSH/local 字段保留。

**选 (b)**（已是当前行为）。**理由**：
- 用户可能在 SSH 输入到一半切换看 local-shell 选项再切回，不应丢失
- 测试断言 (b) 即"字段保留"，并验证必填缺失时 `setError` 被调用、submit 不触发 IPC

### Q9：性能测试的指标

**候选**：(a) 仅断言"完成时间 < X ms" (b) 仅断言"无 OOM/异常完成" (c) 两者都断言

**选 (c)**。**理由**：
- 时间断言要给宽松上限（避免 CI 抖动假阳性）
- TranscriptBuffer 100k 事件追加 < 5s（参考 60ms/k）
- WriteQueue 1000 个 normal + 100 个 high < 2s
- 但更核心是"无 unhandled promise rejection / 内存稳定"

### Q10：是否在 vitest.config.ts 引入 unit/integration 分组

**候选**：(a) 引入 (b) 不引入

**选 (b)**。**理由**：
- 当前 463 个测试 < 30s 跑完，没有性能压力
- 引入分组会改 `pnpm test` 行为（CI 解析或别的 PR 的 watch 受影响）
- DEVELOPMENT_PLAN.md 验收标准 "npm test < 30s (unit) / < 2min (integration)" 在不分组时合并测如果还能在 2min 内完成就达标
- Low-risk 改动留给 Phase 13+ 重构

## Phase 4: Architecture（候选 + 选中）

由于本 Phase 90% 是新增测试 + 1 个简单功能（confirm 字段），无跨模块抽象需求，三个架构方案会高度趋同——**跳过并行 3-architect**（节省 token），inline 选定 **Pragmatic Balance**（与 2x 工作量、规则默认一致）。

### 选中方案：Pragmatic Balance

#### 改动文件清单

**新增功能（confirm 字段）—— 3 文件**

1. `src/shared/error-codes.ts` — 增 `CONFIRMATION_REQUIRED`
2. `src/mcp/registry.ts` — `ToolErrorCode` 联合加 `'CONFIRMATION_REQUIRED'`
3. `src/mcp/surfaces/debug/schemas.ts` — 5 个工具 schema 加 `confirm: z.boolean().optional()`
4. `src/mcp/surfaces/debug/error-translate.ts` — 加 `ConfirmationRequiredError` 类 + 翻译分支
5. `src/mcp/surfaces/debug/tools.ts` — 5 个工具 entry 在调 backend 前 `if (!input.confirm) throw new ConfirmationRequiredError(...)`
6. （可选）更新 5 个工具的 description 文本说明"confirm: true 必填"

**新增测试 —— 6 文件**

1. `tests/integration/serial-no-data.test.ts` — 场景 1
2. `tests/integration/serial-manual-entry.test.ts` — 场景 2（discovery=[] 仍能创建任意 path）
3. `tests/integration/connection-dialog-type-switch.test.tsx` — 场景 6（happy-dom）
4. `tests/integration/high-impact-confirmation.test.ts` — 场景 9（5 个工具 × confirm 缺失/false/true）
5. `tests/integration/perf-transcript-buffer.test.ts` — 100k 事件性能
6. `tests/integration/perf-write-queue.test.ts` — 高并发 + 高优先级抢占

**已覆盖、不重复**：场景 3/4/5/7/8（在决策记录里登记追溯链接）。

#### 数据流（confirm 字段）

```
MCP 客户端调 flash_download({ binaryBase64, address: 0x..., confirm: false })
  ↓
zod schema 验证（confirm 是 optional boolean，过）
  ↓
tools.ts entry 函数：
  if (!input.confirm) throw new ConfirmationRequiredError('flash_download')
  ↓
runJLink 包装的 translateJLinkError(err) 看到 ConfirmationRequiredError
  ↓
返回 { success: false, error: { code: 'CONFIRMATION_REQUIRED', message, details: { tool: 'flash_download' } } }
```

#### 实施顺序

1. 先加 5 个新 integration test 文件（其中场景 9 写"期望失败"断言），跑测会失败
2. 加 `CONFIRMATION_REQUIRED` 双向同步 + `ConfirmationRequiredError` 类
3. 5 个 schema + 5 个 tools entry 加 confirm 闸门
4. 跑 `pnpm test` 验所有新测试 + 现有 462+11=473 测试全过
5. 加 2 个 perf 测试
6. 跑 lint / build / validate:licenses

#### 为什么没选 Minimal / Clean

- **Minimal**：不引 `CONFIRMATION_REQUIRED` 错误码，复用 `INVALID_ARGUMENT`。劣势：AI 客户端无法区分"参数错"vs"需要确认"，违背 MCP 工具应当让客户端能编程化处理的原则
- **Clean**：抽 `withConfirmGate()` 高阶 schema/tool 包装 + `ConfirmRequiredError` 通用基类，可被未来 UI 工具/SSH 工具复用。劣势：5 个工具不值得抽包装层；Phase 12 是收尾不是基建期；YAGNI

## Phase 5: Implementation（实施摘要）

实施代理（2026-06-14）输出：

### 实际改动文件

**新增功能（confirm 闸门）—— 5 个源文件**

1. `src/shared/error-codes.ts` — 加 `CONFIRMATION_REQUIRED`
2. `src/mcp/registry.ts` — `ToolErrorCode` 联合加 `'CONFIRMATION_REQUIRED'`
3. `src/mcp/surfaces/debug/error-translate.ts` — 新增 `ConfirmationRequiredError` 类 + translateJLinkError 分支（放在 ToolError 透传之后、其余 JLinkError 分支之前，保证守门错误走专用 ToolError 编码）
4. `src/mcp/surfaces/debug/schemas.ts` — 5 个工具加 `confirm: z.boolean().optional().describe(...)`，抽 `confirmField` 复用以保证文案一致
5. `src/mcp/surfaces/debug/tools.ts` + `tools-binary.ts` — 5 个工具的 entry 在 `runJLink(...)` 内 `if (input.confirm !== true) throw new ConfirmationRequiredError(toolName)`，并把 binary tools 中"先 decodeBase64 再守门"的顺序反过来——守门在前，避免 16 MiB base64 在守门失败时白白消耗 CPU

**新增测试 —— 6 文件 / 27 个 it（计入总数）**

1. `tests/integration/serial-no-data.test.ts`（场景 1）— 2 it
2. `tests/integration/serial-manual-entry.test.ts`（场景 2）— 2 it
3. `tests/integration/connection-dialog-type-switch.test.tsx`（场景 6, happy-dom）— 4 it
4. `tests/integration/high-impact-confirmation.test.ts`（场景 9）— 5 工具 × 3 状态 = 15 it
5. `tests/integration/perf-transcript-buffer.test.ts` — 2 it（{timeout: 30_000}）
6. `tests/integration/perf-write-queue.test.ts` — 2 it（{timeout: 30_000}）

**回归调整**

- `tests/unit/mcp/debug/tools.test.ts` — `cpu_reset` 调用补 `confirm: true`（1 处）
- `tests/unit/mcp/debug/tools-binary.test.ts` — `flash_download` 成功路径调用补 `confirm: true`（2 处）；schema-cap 拒绝路径不需要 confirm（zod 在守门之前 reject）

### 实施过程小决策（自动选取）

#### Q-impl-1：confirmField 是否在 schemas.ts 抽公共变量

**候选**：(a) 5 个 schema 各自 inline (b) 抽 `const confirmField = z.boolean().optional().describe(...)`
**选 (b)**。**理由**：5 处文案需要保持一致（"Must be true to execute this high-impact operation..."），inline 复制粘贴极易漂移；放进 schemas.ts 文件头部与 `confirmField` / `addressField` / `probeIdField` 的命名风格一致。

#### Q-impl-2：tools.ts 5 个工具描述里要不要附加 confirm 提示

**候选**：(a) 不动 description (b) 在每个 description 后追加一行说明 confirm 语义
**选 (b)**。**理由**：MCP 客户端通常先读 description 理解工具，再看 schema；只在 schema describe 里说"required"会被忽略。description 末尾追加"High-impact: requires confirm=true; otherwise CONFIRMATION_REQUIRED is returned."一行让 AI 客户端先验提示。

#### Q-impl-3：守门 throw 位置 — runJLink 之外 vs 之内

**候选**：(a) `runJLink` 之外（schema-level if-throw）(b) `runJLink` 之内
**选 (b)**。**理由**：题目要求和 binary-codec.ts 的 `decodeBase64Capped` 模式保持一致——所有"调 backend 之前的 fail-fast 异常"都通过 `runJLink` 的 `instanceof ConfirmationRequiredError` 翻译到 ToolError，避免 entry 函数自己写两套错误处理路径。binary tools 的 `flash_download` 把守门挪到 `decodeBase64Capped` 之前，让大 payload 在守门失败时不必白做 base64 解码。

#### Q-impl-4：perf-transcript-buffer 的 truncated 触发量

**候选**：(a) +1 条事件 (b) +10 条事件
**选 (b)**。**理由**：`TranscriptBuffer.readSince(cursor)` 把 `cursor === earliest - 1` 视为"恰好读到 earliest 的前一条"不算截断；只追加 1 条溢出后 `readSince(1)` 仍返回 `truncated:false`。+10 条让 `earliest >= 11`，`readSince(1)` 稳定触发 truncated。这个细节是 transcript-buffer.ts:116 的边界条件。

#### Q-impl-5：connection-dialog-type-switch 是否模拟 Radix Select 真实点击

**候选**：(a) 用 user-event 点击 SelectTrigger → SelectItem (b) 通过 Zustand `connectionDialogPrefill` 触发类型切换
**选 (b)**。**理由**：现有 ConnectionDialog 单测注释（test #5）已经标注 Radix Select 在 happy-dom 下下拉无法稳定点击。Phase 12 要求"测端到端语义"，prefill 路径恰好是 MCP `ui_configure({action:'open_connection_dialog', prefill})` 的同一入口，覆盖比模拟点击更接近生产场景。

#### Q-impl-6：high-impact-confirmation 测试是否覆盖 5 工具 × 3 状态全 15 个 case

**候选**：(a) 表驱动 5 × 3 = 15 (b) 抽样 5 × 1（每工具一个 happy + 一个 reject）
**选 (a)**。**理由**：题目明确要求"5 个工具 × 3 种 confirm 状态（缺失 / false / true）"；表驱动既覆盖完全又只占 ~150 行代码。FakeJLinkBackend 对 5 个方法的 happy path 都已实现，confirm:true 的成功断言是免费的。

### 验收命令结果

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | 通过（无警告） |
| `pnpm test` | 49 文件 / **500 tests passed**（473 → 500，+27 it） |
| `pnpm run build` | 通过（renderer chunk 622 KB，与 Phase 11 持平） |
| `pnpm run validate:licenses` | PASS: 19 deps |


## Phase 6: Review（三视角评审）

并行派 3 个 `feature-dev:code-reviewer`（Simplicity / Bugs / Conventions）。

### 汇总报告

#### Critical / High

无。三方一致认定 confirm 闸门设计与实现质量较高：守门发生在 backend 调用与 base64 decode 之前；MCP description / 错误码 / 测试 ledger 三者一致；ESM/JSDoc/双向同步/instanceof 翻译/无新依赖等 11 项硬约束全部通过。

#### Medium（同期已修）

- **M1（B + C 一致）：`gdb_server_start` confirm 检查嵌在 `withAbortableTimeout` 内** — 与 `flash_download/flash_write` 的"守门在 timer 之前"风格不一致。
  - 处置：把 confirm 检查搬到外层 `runJLink(async () => { if (!input.confirm) throw new ConfirmationRequiredError(...) ... })`，与 binary tools 写法一致
- **M2（A）：connection-dialog test 直接断言 zustand 内部状态** — 违反"测 UI 行为"原则。
  - 处置：改为 `expect(screen.getByRole('dialog')).toBeInTheDocument()`
- **M3（A）：4 个 it 重复 prefill→open 仪式** — DRY 缺失。
  - 处置：抽 `openDialogWithPrefill(prefill)` helper，4 个 it 复用
- **M4（B）：connection-dialog test 单次 setTimeout(0) flush 不充分** — CI race。
  - 处置：local-shell submit 用 `await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(1))`
- **M5（B）：perf-transcript-buffer 第二 it `< 1000ms` CI 偏紧** — 实测 600-800ms 抖动风险。
  - 处置：抬到 `< 3000ms`，与第一个用例 5s 风格一致

#### Low（推迟到 Phase 13+ backlog）

- **L1（A）：test 1 / test 2 在 `serial-no-data` 实质冗余**（两次 setImmediate vs 50ms 计时） — 不影响功能
- **L2（A）：5 处 confirm 守门可抽 `requireConfirm()` helper** — ROI 低，未来增加确认型字段时再抽
- **L3（A）：`perf-write-queue.test.ts` 用 `findLastIndex` 替代 reduce-max** — 可读性微优化
- **L4（A）：`perf-transcript-buffer.test.ts` 单 it 5 个独立断言可拆** — 失败定位优化
- **L5（B）：`tools-binary.ts` 注释加 "confirm 闸门 + schema cap 对齐" 一行** — 审计可读性
- **L6（B）：`perf-write-queue.test.ts` 注释 "立即同步 reject" 改为 "立即返回 rejected Promise"** — 措辞精确度

### 修复后验收

修复后 `pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses` 仍全绿，500 测试通过（数量不变——仅修内部断言/helper 抽取，不增删 it）。

## Phase 7: Summary（验收）

修复后跑 4 条验收命令，全部绿通过：

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | exit 0，0 error / 0 warning |
| `pnpm test` | exit 0，**500 个测试通过**（baseline 473 + 27 个 Phase 12 新增） |
| `pnpm run build` | exit 0，`tsc -b` + `vite build` 双侧成功（renderer chunk 622 KB） |
| `pnpm run validate:licenses` | exit 0，PASS: All 19 dependencies have valid license entries |

**Phase 12 交付完成**：

- **9 个边界场景全覆盖**：场景 1/2/6/9 新增 4 个 integration 测试；场景 3/4/5/7/8 已被 Phase 1-9 单测覆盖（决策记录登记追溯链）
- **新功能：5 个高影响 MCP 工具引入 confirm 闸门**（`flash_download` / `flash_write` / `flash_erase` / `cpu_reset` / `gdb_server_start`），返回 `CONFIRMATION_REQUIRED` 错误码，AI 客户端可编程化区分"参数错"vs"需要二次确认"
- **2 个性能测试基线**：TranscriptBuffer 100k 事件容量 + WriteQueue 高并发抢占
- **测试数 473 → 500**（+27 it）
- **架构一致性**：confirm 闸门 throw 在 `runJLink` 内、`translateJLinkError` 接住、`ERROR_CODES` + `ToolErrorCode` 双向同步——延续 Phase 9-11 的 M5 错误码模式

LinkTerm v2 13 个 Phase 全部完成。从此 AI 客户端调高影响 J-Link 工具必须显式 `confirm: true`，否则 backend 不被触发；所有 9 个需求文档边界场景有自动化测试覆盖；TranscriptBuffer/WriteQueue 在大负载下行为可观测。
