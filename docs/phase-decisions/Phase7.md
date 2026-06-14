# Phase 7 决策记录 — 嵌入式终端规则 + 增强 sendAndWait

执行日期：2026-06-13
执行模式：全自动（用户预先授权一律选推荐项）
工作量：3x（最高风险阶段）

## Phase 1: Discovery（目标摘要）

实现统一嵌入式终端交互规则和跨 chunk 完成标记检测。**技术风险最高阶段。**

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

### 关键架构决策（来自原始计划）

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

依赖阶段：Phase 1, Phase 2, Phase 4。

## Phase 2: Exploration（代码库勘探）

### 1. 现有 `send_and_wait` MCP 工具

- 入口：`src/mcp/surfaces/terminal/tools.ts:213-261`，schema `src/mcp/surfaces/terminal/schemas.ts:131-137`
- 当前实现 `waitForDeviceOutput`（`tools.ts:309-356`）**绕过 SessionManager.waitFor**，直接订阅 `session.on('event')`，谓词写死 `event.type==='data' && event.origin==='device'` —— 任意一条 device data 即 resolve。无 closed/errored 短路，无 cross-chunk 检测。
- 写入路径合规：经 `sessionManager.write(..., {origin:'ai', correlationId})`，audit 事件正常入 transcript。
- Schema 缺 completionMarker / regex / echoStrategy（注释明示 Phase 7 引入）。
- 失败模式：超时 throw `ToolError('TIMEOUT')` —— Phase 7 决策要求改成结构化 `success:false, reason:'timeout'`。

### 2. SessionManager.waitFor

- 位置：`src/core/session/session-manager.ts:310-397`
- 签名：`waitFor(sessionId, predicate, { timeoutMs?, replayHistorySince? }) -> WaitForOutcome`
- **`WaitForOutcome.kind` 实际值为 `'match' | 'timeout' | 'closed'`**（注意：CLAUDE.md 文档写成 `'matched'` 是文档误写，代码字面值为准）
- 进入即终态短路；`replayHistorySince` 触发 `session.read(cursor)` 历史回放（FSM 跨 chunk 检测的钩子）；`'event'` + `'state'` 双监听；并发互不干扰；predicate 异常被静默吞掉（FSM 必须自管异常）
- timeoutMs 必须 > 0 有限；缺省 30000

### 3. TranscriptBuffer

- 关键文件：`src/core/transcript/{transcript-buffer.ts, types.ts, index.ts}`
- API：`append`/`readSince`/`snapshot`/`latestCursor`/`earliestCursor`/`size`
- sequence 单调递增不复用；clear 强制覆盖 `meta.kind='clear'` 写 `precedingCursor`；`truncated=true` 时 `oldestAvailableSequence-1` 是 detector cursor 恢复点
- `'data'` 事件 `evidenceKind='raw_bytes'`（SessionBase 写死）
- `SessionBase.recordSystemEvent` 是 protected — Phase 7 若要标记完成事件，要么 SerialSession 子类内调，要么不写 transcript（detector 命中信息只回 evidence）

### 4. Serial 终端模式

- `mode: 'normal' | 'terminal'` 字段当前**完全是装饰品**：`SerialSession` 仅存储为 `readonly mode`，`SerialTransport` 不读它
- Phase 7 的关键改造点；唯一注解 `serial-session.ts:18-19`
- SSH / local-shell 没有 mode 字段，天生 PTY；Phase7.md 决策 4 要求"终端规则仅在 terminal mode 生效" → 推荐对 SSH/local-shell 默认应用规则（PTY 行为对齐），Serial 看 mode

### 5. WriteQueue 与 Origin

- 接口：`src/core/write-queue/{write-queue.ts, types.ts}`，`enqueue({origin, data, correlationId?, priority?})`
- 不变量：write 必走 SessionManager.write → SessionBase.write → WriteQueue.enqueue → transport.write
- sendAndWait 写入用 `priority: 'normal'`（high 仅留 Ctrl-C/abort）
- `WriteQueueFullError` 当前在 tools.ts 一刀切透传 → Phase 7 显式翻 `ERROR_CODES.QUEUE_FULL`

### 6. 测试 fixture 现状

| Fixture | 入站驱动 | chunk 支持 |
|---|---|---|
| `MockTransport.pushIncoming(Uint8Array)` | ✅ | detector 单元测试首选 |
| `FakeSerialPort.pushIncoming(Buffer\|Uint8Array)` | ✅ | serial 终端模式集成测试 |
| `FakePty.pushIncoming(string)` | ✅ | 注意 detector 接口需支持 string\|Uint8Array |
| `FakeSshChannel.pushIncoming(Buffer\|Uint8Array)` | ✅ | |

**结论：现有 fixture 完全够用，无需新增。**

### 7. 已识别风险（Phase 7 实施时必须留意）

1. **echo 剥离**：当前 predicate 过滤 `origin==='device'`；Phase 7 需要在 detector 内同时看到 AI write 字节（origin='ai'）做回显标记，再喂 device 字节给 FSM。不能继续粗暴过滤 origin。
2. **transcript 截断**：`readSince` 在长跑 + 小 buffer 容量下会 truncated；detector 需要每次取 `result.cursor` 续读。
3. **predicate 异常被吞**：FSM 内部异常需自处理或显式抛后 wrap。
4. **`mode` 现有 IPC/MCP 已暴露**：实装后向用户的承诺会突然兑现，docs 要写明。
5. **不要把 `'match'` "修正"为 `'matched'`** 否则 ai-human-coop 测试 break。

## Phase 3: Clarifying（自动应答）

| # | 歧义点 | 候选项 | 选中 | 理由 |
|---|---|---|---|---|
| C1 | TerminalRuleSet 字段范围 | (a) 仅 `lineEnding + completionMarkers + defaultTimeoutMs + echoStrategy`；(b) 加入 `interCharDelayMs / promptPattern / errorMarkers` | **(a) 最小集** | Phase7.md 决策 2 "统一规则适用所有设备"，先收敛字段；后续 Phase 11/12 可再扩。错误标记可用普通 marker 表达 |
| C2 | `lineEnding` 默认值 | `\r\n` / `\n` / 配置必填 | **`\r\n` 默认，可覆盖** | 嵌入式 RTOS / Zephyr / U-Boot 等约定 CRLF；PTY 也兼容 |
| C3 | `defaultTimeoutMs` 默认 | 5000 / 10000 / 30000 | **5000** | 嵌入式命令通常亚秒返回；30000 是 waitFor 的安全网；MCP 调用方可覆盖 |
| C4 | CompletionMarker 表达式形态 | string / RegExp / `string \| RegExp` 联合 | **`string \| RegExp`** | string 用 byte 包含匹配（覆盖大部分 prompt 场景）；RegExp 处理 `\d+\>` 等动态 prompt |
| C5 | RegExp 怎么跨 chunk 匹配 | (a) 把所有 chunk 累加 + 整体 `regex.test`；(b) 滑窗 + 部分匹配 | **(a) 累加 buffer + test** | RegExp 状态机难以增量匹配；累加 buffer 上限默认 64KB（marker 命中后清空），实现简单且测试可验证 |
| C6 | `echoStrategy` 候选 | `'auto' / 'strip' / 'keep'` | **`'auto'` 默认；'strip'/'keep' 可显式覆盖** | auto = 检查首字节是否与 AI write 字节匹配，命中则剥离；嵌入式 / SSH 默认开启回显 |
| C7 | echo 剥离粒度 | 整行 / 精确字节计数 / 通过 lineEnding 切分 | **精确字节计数** | 终端可能在 echo 与回包间穿插 ANSI；按 byte 计数最稳；要求 detector 知道 AI 已写入的字节序列 |
| C8 | sendAndWait 超时返回结构 | (a) throw ToolError；(b) 返回 `{success:false, reason:'timeout', received, cursor}` | **(b) 结构化** | Phase7.md 决策 3 明确"超时返回结构化信息，不切换模式"。MCP 工具层把 `success:false` 映射为 evidence 仍带数据 |
| C9 | session 中途关闭返回 | 同 timeout / 独立 reason='session-closed' | **独立 `reason: 'session-closed'`** | waitFor 已区分 closed/timeout；调用方可据此决定重连还是重试 |
| C10 | 终端规则覆盖 transport 类型 | 仅 serial+terminal mode / serial(terminal) + ssh + local-shell / 全部 | **serial(terminal) + ssh + local-shell** | SSH/local-shell 天生 PTY；serial normal 模式不应用（用户决策点 4）；保持向后兼容 |
| C11 | sendAndWait orchestrator 位置 | `src/core/terminal-rules/send-and-wait.ts` 纯函数 / SessionManager 方法 | **纯函数 + 注入 SessionManager** | core 模块不耦合 SessionManager 类；测试可注入 mock manager |
| C12 | detector 输入接口 | `feed(Uint8Array)` / `feed(Uint8Array \| string)` / 同时支持 | **`feed(Uint8Array)`** | string→bytes 由调用方做（PTY fixture 例外）；detector 接口纯字节，更简单可测 |
| C13 | RegExp marker 的 source/flags 序列化 | 直接 `RegExp` 实例 / `{ pattern, flags }` 对象 | **`RegExp` 实例对内 API；JSON schema 入参用 `{ pattern, flags? }` 对象** | core 内部 ergonomic；MCP/IPC 边界 zod 解析为对象再 `new RegExp` |
| C14 | Serial mode='terminal' 写入是否自动追加 lineEnding | 是 / 否 | **是（可显式 `appendLineEnding:false` 关闭）** | 嵌入式终端默认按行；用户已选 terminal 模式即明确意图 |
| C15 | sendAndWait 是否回写 transcript "完成"事件 | 是（system event）/ 否 | **否** | TranscriptBuffer append-only 已记录所有 AI/device 字节；额外 system 事件冗余且需扩 evidence kind；命中信息仅回 evidence.data 即可 |

## Phase 4: Architecture（候选 + 选中）

### 三方案精要对比

| 维度 | Architect A: Minimal | **Architect B: Clean ✅** | Architect C: Pragmatic |
|---|---|---|---|
| 文件数 | 6 新增 + 5 修改 | 6 新增 + 5 修改 + 常量集中 | 6 新增 + 5 修改 + error-codes |
| SessionManager 耦合 | 直接 import | **`SessionManagerLike` 接口隔离** | 直接 import（mock 4 方法） |
| `appendLineEnding` 实现位置 | 下沉到 `SessionWriteOptions`（serial 子类消费） | orchestrator 内部拼接 | orchestrator 内部拼接 |
| 错误码 | 复用既有 | 复用既有 | 新增 `SESSION_CLOSED` |
| 超时 MCP 翻译 | ToolError(TIMEOUT) + details | success:false 结构化结果 | success:false（与既有约定有偏差） |
| Phase 8/9 扩展 | 较弱（rules 强耦合） | **rules 是 `Partial<TerminalRuleSet>`，可叠加 workspace/chip 配置** | 中等 |
| 测试 mock 复杂度 | 低（直接用真 SessionManager） | 中（mock SessionManagerLike 4 方法） | 中 |

### 选中：Architect B（Clean Architecture）

**理由**：

1. **3x 工作量 + 最高风险阶段** —— /next-phase 工作流默认规则："工作量 ≥3x 优先 Clean Architecture（更易测试与后续迭代）"
2. **可扩展性符合后续 Phase 需要** —— Phase 8（workspace config）会让 `terminalRules` 从工作区读，`Partial<TerminalRuleSet>` + `mergeRules` 三级合并已天然支持；Phase 9（J-Link MCP）的 RTT 输出复用 detector，`SessionManagerLike` 接口让 J-Link backend 实现子集即可
3. **append-only transcript 不变量更稳** —— Clean 明确把 echo 剥离限定为"喂给 detector 的视图"，不动 TranscriptBuffer
4. **测试边界清晰** —— L1 数据 / L2 字节 FSM / L3 编排 / L4 适配，每层独立单测；集成测试只跑 L3

### 对 Architect B 的微调（融入 Pragmatic 优点）

- 采纳 Architect B 的整体分层与接口隔离
- 但 `SendAndWaitResult` 的 `reason` 取 Architect C 的命名（`'matched'` 与代码一致而非 `'completed'`）
- 错误码不新增 `SESSION_CLOSED`：closed 在 result 用 `reason: 'session-closed'`，MCP 翻 `INTERNAL` + sessionState 字段（避免错误码过度膨胀）
- 不引入 `SerialSession.appliesTerminalRules` 标志：orchestrator 直接根据 rule 是否启用判断（Architect A 风格的简洁）
- `SessionManagerLike` 仅暴露 4 方法：`write` / `waitFor` / `read`（用于 cursorBefore 与 cursorAfter）

### 最终交付清单（与 Phase 1 一致 + 微调）

| 路径 | 类型 | 摘要 |
|---|---|---|
| `src/core/terminal-rules/types.ts` | 新增 | `TerminalRuleSet` / `CompletionMarker` / `EchoStrategy` / `DetectorState` / `SendAndWaitResult` / `SendAndWaitDeps` / `SessionManagerLike` |
| `src/core/terminal-rules/rules.ts` | 新增 | `DEFAULT_TERMINAL_RULES`、`mergeRules`、`appendLineEnding`、`parseMarkerSpec` |
| `src/core/terminal-rules/completion-detector.ts` | 新增 | 有状态 FSM；KMP 字节匹配 + RegExp 累计 buffer；64KB 上限丢头保尾 |
| `src/core/terminal-rules/echo-handler.ts` | 新增 | `EchoHandler` 类；按字节精确剥离；'auto'/'strip'/'keep' 三策略 |
| `src/core/terminal-rules/send-and-wait.ts` | 新增 | 纯函数 orchestrator，注入 `SessionManagerLike` |
| `src/core/terminal-rules/index.ts` | 新增 | barrel export |
| `src/shared/constants.ts` | 修改 | `TERMINAL_RULES_DEFAULT_TIMEOUT_MS`、`COMPLETION_BUFFER_MAX_BYTES`、`DEFAULT_LINE_ENDING` |
| `src/transports/serial/serial-session.ts` | 修改 | `mode==='terminal'` 时由 orchestrator 主导规则；本身仍只存 mode |
| `src/mcp/surfaces/terminal/schemas.ts` | 修改 | `sendAndWaitInputSchema` 加 `completionMarkers` / `echoStrategy` / `appendLineEnding` / `lineEnding` / `timeoutMs` |
| `src/mcp/surfaces/terminal/tools.ts` | 修改 | `send_and_wait` 接 orchestrator；删除 `waitForDeviceOutput`；超时仍用 ToolError(TIMEOUT) + receivedBase64 |
| `tests/unit/core/terminal-rules/{rules,completion-detector,echo-handler,send-and-wait}.test.ts` | 新增 | 各层单测 |
| `tests/integration/send-and-wait.test.ts` | 新增 | 端到端 |
| `tests/unit/mcp/terminal-tools.test.ts` | 修改 | send_and_wait 新行为断言 |

## Phase 5: Implementation（实施摘要）

执行日期：2026-06-13。所有验收命令绿，新增 53 个测试（4 单元文件 + 1 集成 + MCP 既有测试 4 条改写）。

### 实施期决策记录

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| I1 | CompletionDetector 字符串 marker 匹配算法 | **KMP（带 failure table）** | 跨 chunk 部分匹配最稳；marker 长度通常 < 32，预计算成本可忽略；naive 字节扫描在重叠 marker（如 `ABABC` 喂入 `ABABA`）下会漏匹配 |
| I2 | RegExp marker 匹配算法 | **累加 buffer + 非粘性副本 `regex.test`** | RegExp 状态机难以增量；用 `new RegExp(re.source, re.flags.replace(/[gy]/g,''))` 创建非粘性副本避免共享 lastIndex 污染调用方 |
| I3 | buffer 上限触发后的截断策略 | **保留尾窗 = `min(bufferMaxBytes, max(longestRegexSourceBytes*4, 4096))`** | 既限制内存又保证跨 chunk 命中窗口；字符串-only 模式下 `longestRegexSourceBytes=0`，尾窗退化为 `min(maxBytes, 4096)` |
| I4 | buffer 是否始终维护 | **始终维护（不再以是否含 RegExp 区分）** | 原方案仅 RegExp 模式下维护，导致 timeout 路径无法回填 `received`；改为始终累加，仅 `regex.test` 判断条件保持"有 RegExp 才跑"以省 CPU |
| I5 | 同字节同时命中多 marker 时的优先级 | **按数组顺序优先（首个命中的下标）** | 与文档承诺一致；feed 的内层循环逐 marker 顺序检查，第一个命中即 return |
| I6 | KMP 失败表存储类型 | **`Uint16Array`** | marker 实际长度上限 65535 字节足够；省内存且零 GC 开销 |
| I7 | EchoHandler 不匹配时的处置 | **保守清空整个 expected 队列** | 一旦观察到首个不匹配字节，假定 device echo 模式被打破（如部分驱动只回部分回显），后续直接透传更安全 |
| I8 | `'auto'` vs `'strip'` 实现差异 | **本期一致** | Phase 7 决策 C6 指定 auto = "首字节匹配则剥离，不匹配回退"；strip 现实中不易区分，留给未来扩展严格模式 |
| I9 | base64 编码使用 `Buffer` | **允许 core 使用 Node 原生 `Buffer`** | core 不可依赖 Electron / native binding，但 Node 标准库 `Buffer` 不在禁止列表（与 TranscriptBuffer.append 之类已使用 Node `process` API 一致） |
| I10 | session-closed 在 MCP 层翻译 | **`ToolError(INTERNAL, details.sessionState)`** | 决策文件 Phase 4 选定，避免新增 `SESSION_CLOSED` 错误码；details 含 `sessionState/cursorBefore/cursorAfter/receivedBase64` 帮助 AI 决策 |
| I11 | timeout 同时含 cursorBefore/cursorAfter | **是** | Phase 4 选定的"超时仍带 received 与 cursor"；MCP 测试验证 `error.details.receivedBase64` 与 `cursorBefore` 都存在 |
| I12 | `ToolErrorCode` 是否新增 `QUEUE_FULL` | **是** | 原 union 漏掉，build 时报错；本期补齐让 MCP 在写入背压时可结构化暴露给 AI（让其退避重试） |
| I13 | abort 信号实现 | **`Promise.race(waitPromise, abortPromise)` + once 监听 + 离开时 removeEventListener** | SessionManager.waitFor 不接 AbortSignal；orchestrator 自管 race。`signal.aborted` 预检查处理 pre-abort case |
| I14 | SerialSession.mode='terminal' 是否在 session 内做行为切换 | **不动 SerialSession** | 决策文件 Phase 4 微调："不引入 `SerialSession.appliesTerminalRules` 标志"；规则由 orchestrator 根据 args.rules 决定 |
| I15 | `completionMarkers` 缺省/空数组的语义 | **空数组 = fallback "任意 device 输出即视为完成"** | 兼容 Phase 4 既有 send_and_wait 行为；MCP schema 缺省时不传 markers，orchestrator 检测 `rules.completionMarkers.length===0` 后退化 |
| I16 | tools.ts 删除 `waitForDeviceOutput` 后保留 `serializeEvent` | **保留** | 仍被 `read_from_session` 使用 |

### 文件变更清单

新增（11）：
- `src/core/terminal-rules/types.ts`
- `src/core/terminal-rules/rules.ts`
- `src/core/terminal-rules/completion-detector.ts`
- `src/core/terminal-rules/echo-handler.ts`
- `src/core/terminal-rules/send-and-wait.ts`
- `src/core/terminal-rules/index.ts`
- `tests/unit/core/terminal-rules/rules.test.ts` (15 tests)
- `tests/unit/core/terminal-rules/completion-detector.test.ts` (14 tests)
- `tests/unit/core/terminal-rules/echo-handler.test.ts` (9 tests)
- `tests/unit/core/terminal-rules/send-and-wait.test.ts` (12 tests)
- `tests/integration/send-and-wait.test.ts` (3 tests)

修改（5）：
- `src/shared/constants.ts` —— 新增 3 常量（TERMINAL_RULES_DEFAULT_TIMEOUT_MS / COMPLETION_BUFFER_MAX_BYTES / DEFAULT_LINE_ENDING）
- `src/core/index.ts` —— 增加 terminal-rules barrel re-export
- `src/mcp/surfaces/terminal/schemas.ts` —— send_and_wait input schema 扩展 4 字段（completionMarkers / echoStrategy / appendLineEnding / lineEnding）
- `src/mcp/surfaces/terminal/tools.ts` —— send_and_wait handler 改用 orchestrator；删除 `waitForDeviceOutput`；处理 4 种失败 reason 翻译
- `src/mcp/registry.ts` —— `ToolErrorCode` 联合追加 `'QUEUE_FULL'`
- `tests/unit/mcp/terminal-tools.test.ts` —— 改写 send_and_wait 既有 2 测试 + 新增 2 测试（cross-chunk match / session-closed → INTERNAL 翻译）

### 验收命令输出摘要

```
pnpm run lint       → 0 errors, 0 warnings
pnpm test           → 29 files, 290 tests passed
pnpm run build      → tsc -b ok; vite 118 modules transformed
pnpm run validate:licenses → PASS: 19 deps OK
```

新增测试合计 53 个（11 单元规则 + 14 detector + 9 echo + 12 orchestrator + 3 integration + 4 MCP 改写）。


## Phase 6: Review（三视角评审）

3 个并行 `feature-dev:code-reviewer` 子代理（Simplicity/DRY、Bugs/Correctness、Conventions），下面是合并后的处置清单。

### Critical
- **C1 (Reviewer C)**：DEVELOPMENT_PLAN.md Phase 7 行仍为 ⬜。
  - 处置：归到 Step 7 Summary 修复（与 ✅ 翻牌、变更记录子节、CLAUDE.md 计数同步一并完成）。

### High（已修复 5/5）
- **H1 (Reviewer A) — `EchoStrategy: 'auto' | 'strip'` 是同义词**：合并为 `'auto' | 'keep'`，删 `'strip'` 分支与 schema enum，删一条 echo-handler 测试。
- **H2 (Reviewer A) — sendAndWait 终态 4 份重复**：抽 `finalize(reason, extras?)` helper，把 6 个公共字段集中构造，消除 ~40 行重复。
- **H1 (Reviewer B) — 纯 string-marker 路径下 `received` 被强制截断 4 KB**：`tailWindow` 在 `longestRegexSourceBytes===0` 时回退为 `bufferMaxBytes`，确保 `snapshotBuffer` 保留到配置上限。
- **H2 (Reviewer B) — `flags` 校验过宽 + 热路径每次 `new RegExp`**：schema 用 `regex(/^[dimsu]*$/)` 限制 flags；detector ctor 一次性预编译 `normalizedRe` 缓存到 `MarkerState`。
- **H (Reviewer C) — 文件首部多段段落式 docstring**：保留模块级 1 行 Why；段落式"设计要点"迁到本文件，源码注释收敛。

### Medium（已修复 8/9，1 项标注 N/A）
- **M3 (Reviewer A) — 每帧重建 RegExp 副本**：与 H2(B) 合并修复（ctor 缓存 `normalizedRe`）。
- **M5 (Reviewer A) — `as unknown as SessionManagerLike` 双重 cast**：`SessionManagerLike.read` 返回类型放宽为 `{cursor: SequenceCursor}` 子集，去除 unknown。
- **M6 (Reviewer A) — 测试 `await Promise.resolve()` 重复 11 次**：抽 `flushMicrotasks` helper。
- **M1 (Reviewer B) — pre-abort 仍执行 write 副作用**：在 `observeWrite`/`write` 之前先 `if (signal?.aborted) return finalizeAborted({ bytesWritten: 0 })`。
- **M2 (Reviewer B) — abort 不取消底层 waitFor**：N/A（需扩 `SessionManagerLike.waitFor(signal?)`，超出 Phase 7 收尾范围；登记到 Phase 8 backlog）。
- **M3 (Reviewer B) — MCP 默认 30s 绕过 5s 默认**：tools.ts 改为 `if (input.timeoutMs !== undefined) args.timeoutMs = input.timeoutMs`。
- **M4 (Reviewer B) — fallbackOnAny `matchedMarkerIndex: -1`**：类型改 `number | null`；fallback 命中时为 `null`。
- **M (Reviewer C) — `session-closed` 翻译为 `INTERNAL` 丢语义**：新增 `ERROR_CODES.SESSION_CLOSED` 与 `ToolErrorCode` `'SESSION_CLOSED'`；MCP 分支改用之，测试同步更新。
- **M (Reviewer C) — `'TIMEOUT'` 字面量未走 `ERROR_CODES`**：替换为 `ERROR_CODES.TIMEOUT`。

### Low（不修，登记到 Phase 8 backlog）
- L1/L2 (A/B) — RegExp `matchStart` UTF-16 vs 字节：未对外暴露，文档收敛即可。
- L2 (B) — `decodeDataPayload` 空 base64 通过校验：等价空写入，无害。
- L3 (B) — `EchoHandler.#expected` 长期 echo-off 无界增长：加 `MAX_QUEUE_LEN=4096` 兜底（已顺手修）。
- L7/L8/L9/L10 (A) — 杂项整洁度：有空时清理。

## Phase 7: Summary（验收）

### 文档同步

- `DEVELOPMENT_PLAN.md` Phase 7 行翻为 ✅ 已完成 2026-06-13；新增"实际交付"+"关键架构决策（落地版本）"+"变更记录"子节
- `CLAUDE.md` 进度计数 0–6 → 0–7；测试数 237 → 290；新增"Terminal rules & sendAndWait FSM (Phase 7)"章节，记录 `SessionManagerLike` 接口、KMP/RegExp 缓冲、MCP `parseMarkerSpec` flags 限制、结构化失败 reason 映射、EchoHandler `MAX_QUEUE_LEN` 兜底、AbortSignal pre-abort 短路语义
- `docs/phase-decisions/Phase7.md`（本文件）记录三视角评审与处置

### 验收命令输出（最终）

```
$ pnpm run lint
> eslint src/ tests/
(0 errors, 0 warnings)

$ pnpm test
 Test Files  29 passed (29)
      Tests  290 passed (290)
   Duration  3.04s

$ pnpm run build
tsc -b ok
vite v7 built in 403ms
dist/renderer/assets/index-*.js   620.37 kB │ gzip: 174.75 kB

$ pnpm run validate:licenses
PASS: All 19 dependencies have valid license entries
```

### 关键风险登记（Phase 8 backlog）

- **R1**: `SessionManagerLike.waitFor(signal?: AbortSignal)` 取消机制 —— 当前 abort 后底层 listeners 与 setTimeout 残留至自然 timeout，长时间任务下可能堆积。修复需在 `SessionManager.waitFor` 增加 signal 参数 + cleanup 钩子。Phase 7 评审 M2(B)。
- **R2**: RegExp marker 命中 `matchStart` 用 UTF-16 length 估算字节偏移，UTF-8 多字节字符上有偏差。当前未对外暴露给 MCP evidence；若 Phase 8 引入 highlight/region 字段需先修。Phase 7 评审 L1(A)/L1(B)。
- **R3**: `decodeDataPayload` 允许空 base64 通过（等价空写入）。无害但应在更严格 schema 加严。Phase 7 评审 L2(B)。

### 测试覆盖结构

```
tests/unit/core/terminal-rules/
  rules.test.ts            (15 tests)  行尾 / merge / parseMarkerSpec
  completion-detector.test.ts (14 tests) 单 chunk / 跨 2/3/5 chunk / KMP 重叠 / RegExp / Unicode / buffer 截断
  echo-handler.test.ts     ( 9 tests)  精确剥离 / 失配 flush / MAX_QUEUE_LEN
  send-and-wait.test.ts    (12 tests)  matched / timeout / closed / queue-full / aborted / pre-abort
tests/integration/send-and-wait.test.ts (3 tests) mock transport 分片输出端到端
tests/unit/mcp/terminal-tools.test.ts   (4 改写)  cross-chunk match / SESSION_CLOSED 翻译 / TIMEOUT / QUEUE_FULL
```
