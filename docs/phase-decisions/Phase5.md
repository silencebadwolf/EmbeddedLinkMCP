# Phase 5 决策记录 — AI 与人共同操作加固

执行日期：2026-06-13
执行模式：全自动（用户预先授权一律选推荐项）

## 子代理询问与选择

（由 feature-dev 子代理在执行过程中追加）

### 决策 1：WriteQueue 优先级层级（2026-06-13）

- 问题：高/中/低三级 vs 高/普通两级 vs 数值优先级。
- 候选项：
  1. 两级 `'high' | 'normal'`
  2. 三级 `'high' | 'normal' | 'low'`
  3. 数值 `priority: number`
- 选中：**两级 `'high' | 'normal'`**
- 理由：用户提示明确说"高/普通两级足够"；当前唯一的 high 用例是人手动 abort/Ctrl-C；多级会引入饿死风险（low 永远轮不上）。implementaion 用两条 FIFO list，high 非空就先取 high。

### 决策 2：背压策略（2026-06-13）

- 问题：队列满时如何处理。
- 候选项：
  1. enqueue 立即 reject 携带 `code: 'QUEUE_FULL'`
  2. enqueue 返回 Promise 等待空位
  3. 静默丢弃最旧项
- 选中：**1（reject + code:'QUEUE_FULL'）**
- 理由：用户提示推荐项；让调用方决定退避/重试；2 会让背压向上传染卡住 IPC handler；3 违反审计完整性。`maxDepth` 默认 1024，可在 WriteQueueOptions 配置。

### 决策 3：清屏边界标记（2026-06-13）

- 问题：如何在 transcript 流中标记清屏边界，AI 跨越清屏读取时仍能识别。
- 候选项：
  1. 在 ReadResult 增加 `clearBoundaries: SequenceCursor[]` 字段
  2. 保留 clear 事件本体在事件流中，使用 `type==='clear'` 作为边界识别
  3. 同时做 1 + 2
- 选中：**2，并在 clear 事件 meta 中加 `kind:'clear'` 与 `precedingCursor` 字段**
- 理由：清屏事件本来就在 stream 中（追加写入语义），AI 客户端只要读到 type==='clear' 即知边界；额外 ReadResult 字段会引入冗余。`precedingCursor` 让 UI 能直接拿到"清屏前最后可见 sequence"。

### 决策 4：过期 cursor 返回值扩展（2026-06-13）

- 问题：truncated=true 时 MCP 客户端如何"恢复"读取。
- 候选项：
  1. 仅暴露 `truncated: true`（现状）
  2. 增加 `oldestAvailableSequence` 字段供客户端续读
  3. 抛错让客户端重新协商
- 选中：**2（在 ReadResult 增加 `oldestAvailableSequence: SequenceCursor`）**
- 理由：用户提示推荐项；返回 N 后客户端可设 cursor=N-1 立即恢复；不破坏现有 API（仅追加字段）。

### 决策 5：多客户端 cursor 注册接口（2026-06-13）

- 问题：每个 MCP/IPC 订阅者如何持有自己的 cursor。
- 候选项：
  1. 客户端自己持有 cursor，每次 read 显式传入（现状）
  2. SessionManager 内部维护 `Map<subscriberId, Map<sessionId, cursor>>`，提供 readForSubscriber()
  3. 同时支持 1 与 2
- 选中：**3**
- 理由：MCP terminal surface 现有 8 个工具已经按 1 工作，不应破坏；新增 2 服务于 IPC transcript:subscribe（渲染端不需要管 cursor）和长寿命 MCP 客户端；保留显式 read 不变。

### 决策 6：snapshot() vs readSince(0)（2026-06-13）

- 问题：是否新增 `snapshot()` 方法。
- 候选项：
  1. 复用 readSince(0) 不增加方法
  2. 新增 `snapshot()` 返回 `{events, cursor, oldestAvailableSequence}`，语义等同 readSince(0)
- 选中：**2**
- 理由：语义清晰（"我是新 reader 想要全部"）；测试可读性高；零成本，仅 wraps readSince(0)。

### 决策 7：waitFor 实现位置（2026-06-13）

- 问题：DEVELOPMENT_PLAN 提到"并发 waitFor 协调"，sendAndWait FSM 是 Phase 7 的事。
- 候选项：
  1. Phase 5 仅做 transcript 订阅基础设施，不做 waitFor
  2. Phase 5 实现一个通用的 `SessionManager.waitFor(sessionId, predicate, opts)`
  3. 直接搬到 Phase 7
- 选中：**2，但只覆盖 transcript-event 流的最小协调**（多个 waitFor 可并发，互不干扰，超时独立）
- 理由：让 Phase 5 真的能验证"并发协调"场景，但不引入终端规则/sendAndWait 的协议细节（那些放 Phase 7）；本次的 waitFor 只是"事件流断言+timeout"。

### 决策 8：IPC handler 中 origin 强制规则（2026-06-13）

- 问题：渲染进程能否伪造 origin 字段。
- 候选项：
  1. 信任渲染端传入 origin
  2. session:write IPC 强制 origin='human'，不接受渲染端字段
- 选中：**2**
- 理由：req §4.4 / §5.1 安全边界；渲染进程是受信任进程但不应有伪造 AI 身份的能力；MCP 工具用 origin='ai'，二者通道严格分离。

### 决策 9（review 第二轮）：H1 — 高优先级写入豁免 maxDepth（2026-06-13）

- 问题：normal 把队列堆到上限时，high 是否也应被 reject？
- 候选项：
  1. 一刀切：高/普通都受 maxDepth 约束（现状）
  2. high 完全豁免 maxDepth
  3. 给 high 一个独立小容量上限
- 选中：**2（high 完全豁免）**
- 理由：high 唯一用例是用户主动 Ctrl-C/abort，恰恰是远端卡死、normal 堆满的场景下最需要可达；3 引入新配置面但语义收益不大；调用方已被 types 注释约束"仅中断场景使用"，滥用空间小。

### 决策 10（review 第二轮）：M2 — waitFor 在 session 终态立即 settle 的 outcome 类型（2026-06-13）

- 问题：predicate 不命中、session 中途 close/errored 时 waitFor 如何返回？
- 候选项：
  1. 扩展 outcome 增 `kind: 'closed'`（含 lastCursor 与 state: 'closed'|'errored'）
  2. 沿用 `kind: 'timeout'` 但 reason 标"session closed"
  3. 抛错
- 选中：**1（新增 `kind: 'closed'`）**
- 理由：上层 sendAndWait（Phase 7）需要区分"预期超时"与"目标设备已不可达"才能选择重连/放弃；2 让调用方拿不到准确语义；3 与既有"超时不抛错"的契约不一致。当前 waitFor 只有 ai-human-coop.test.ts 在用，扩展 kind 不会破坏外部消费者；同步在 `src/core/session/index.ts` 重新导出。

### 决策 11（review 第二轮）：M3 — IPC/MCP 非 open 状态错误归类（2026-06-13）

- 问题：write 在非 open 状态下抛的错误，IPC 与 MCP 工具如何归类？
- 候选项：
  1. IPC handler 字符串匹配 `'is not open'` 翻译为 NOT_OPEN
  2. 在 SessionBase 抛具名错误 `SessionNotOpenError`（含 `code:'NOT_OPEN'` + sessionState），IPC/MCP 用 `instanceof` 翻译
- 选中：**2（具名错误 SessionNotOpenError）**
- 理由：字符串匹配脆弱（消息变更即静默失效）；具名错误带类型化字段（sessionState）便于客户端 UI 提示；IPC / MCP 复用同一来源；MCP 工具仍保留 `message.includes('is not open')` 的 fallback 兜底。错误命名取 `SessionNotOpenError`（与 `WriteQueueFullError` 命名风格一致），从 `src/core/session/index.ts` 导出。

### 决策 12（review 第二轮）：M4 — transcript:subscribe 'destroyed' 监听守卫（2026-06-13）

- 问题：同一 webContents 多次调用 subscribe 会累积多个 'destroyed' once 监听。
- 选中：用 `if (!subscribers.has(wc.id))` 守卫，仅在首次注册时挂 once。
- 注：本期不补 IPC 端到端测试（缺乏 ipcMain 测试基建），在 handler 注释里说明守卫存在原因，留待 Phase 6 IPC 端到端测试覆盖。


## 自动执行的操作

### 子代理选型（2026-06-13）

- 问题：`/next-phase` 命令文件指定调用 `feature-dev:feature-dev` agent，但实际 agent 列表里只有 `feature-dev:code-architect / code-explorer / code-reviewer`（`feature-dev:feature-dev` 是 skill 不是 agent）。
- 候选项：
  1. `backend-developer` — 后端服务/API/并发处理专家
  2. `fullstack-developer` — 跨层完整 feature
  3. `feature-dev:code-architect` — 仅设计蓝图，不写代码
  4. `general-purpose` — 通用
- 选中：**`backend-developer`**
- 理由：Phase 5 全部交付物都在 main 进程 / core 模块 / IPC / 测试层，无 UI 改动；backend-developer 对并发模型、队列、背压、IPC 最对口；code-architect 只画图不写码不符合"自动执行代码"的目标；fullstack 范围超出本 Phase。

## 验收命令输出

（最后追加 lint / test / build / validate:licenses 的结果摘要）

## Code Review（2026-06-13，feature-dev:code-reviewer）

### Critical：无

### High（必须修）

**H1. 高优先级写入不豁免 maxDepth** — `src/core/write-queue/write-queue.ts:68-76`
- 设计意图（types.ts:6-13 注释）`'high'` 是用户主动 Ctrl-C/abort 的紧急通道，但 enqueue 用统一 `pendingCount() >= maxDepth` reject，high 不享豁免
- 后果：远端卡死/AI 抓狂正是需要 Ctrl-C 的时刻，背压把 high 也拒掉，用户失去中断手段
- 修：`priority='high'` 旁路 maxDepth 检查（或独立小容量 high 上限）；测试补"队列满时 high 被接受并最先 drain"

**H2. IPC `session:write` priority 字段链路断开** — `src/main/ipc/session-ipc.ts` ↔ `src/core/session/types.ts` ↔ `src/core/session/session-base.ts`
- `SessionWriteRequest.priority` 在 IPC 入参声明，但 `SessionWriteOptions` 无该字段、`SessionBase.write` 不透传，最终全退化为 normal
- 后果：H1 修复也救不回 Ctrl-C 路径，因为参数根本到不了 WriteQueue
- 修：`SessionWriteOptions` 加 `priority?`，SessionBase.write 透传 enqueue，IPC handler 把 req.priority 一并塞进去

### Medium（一并处理）

**M1. clear 事件 meta 合并顺序允许覆盖 `kind:'clear'`** — `transcript-buffer.ts:56-67`：spread 在后会被调用方覆盖；改为 `{ ...(meta ?? {}), kind:'clear', precedingCursor }`，注释同步修正

**M2. `waitFor` 不响应 session close/errored** — `session-manager.ts:303-371`：会等满 timeoutMs；加 state 事件监听，session 进入 closed/errored 时立即 settle（kind: 'closed' 或归 'timeout'）；补并发测试

**M3. IPC `session:write` 非 open 状态归类为 INTERNAL** — `session-ipc.ts:114-137,310-324`：与 MCP 工具的 `NOT_OPEN` 不一致；显式翻译 `'is not open'` 为 `code:'NOT_OPEN'`，或在 SessionBase 抛带 code 的具名错误共享

**M4. `transcript:subscribe` 同一 webContents 多次订阅累积 `'destroyed'` once 监听** — `session-ipc.ts:224-253`：用 `if (!subscribers.has(wc.id))` 守卫只在首次注册

### Low（推迟）

- `dispose()` 路径无显式 `unsubscribe` —— 热替换才有意义
- `terminal/tools.ts:411` cancel 标 `'timeout'` 而非 `'cancelled'` —— 语义别扭，未来调用 `await waiter.promise` 会被骗


### 2026-06-13 验收摘要

```
$ pnpm run lint
> eslint src/ tests/
（无输出，0 error 0 warning）

$ pnpm test
 Test Files  15 passed (15)
      Tests  165 passed (165)

$ pnpm run build
> tsc -b && vite build
dist/renderer/index.html                   0.43 kB
dist/renderer/assets/index-*.css           10.41 kB
dist/renderer/assets/index-*.js           193.14 kB
✓ built in 233ms

$ pnpm run validate:licenses
PASS: All 9 dependencies have valid license entries
```

测试增量：139 → 165（+26）。
- write-queue.test.ts +12（priority 3、correlationId 2、backpressure 4 等）
- transcript-buffer.test.ts +5（clear cursor 边界 4、过期 cursor 恢复 3、snapshot 1）
- ai-human-coop.test.ts +9（6 个核心场景 + 3 个并发协调附加）

### 2026-06-13 验收摘要（review 后第二轮）

```
$ pnpm run lint
> eslint src/ tests/
（无输出，0 error 0 warning）

$ pnpm test
 Test Files  15 passed (15)
      Tests  172 passed (172)

$ pnpm run build
> tsc -b && vite build
dist/renderer/index.html                   0.43 kB
dist/renderer/assets/index-fe8sFVaE.css   10.41 kB
dist/renderer/assets/index-Dw2FH2b1.js   193.14 kB
✓ built in 178ms

$ pnpm run validate:licenses
PASS: All 9 dependencies have valid license entries
```

测试增量（review 第二轮）：165 → 172（+7）。
- write-queue.test.ts +1（high 豁免 maxDepth + 优先 drain）
- transcript-buffer.test.ts +1（clear meta 强制覆盖 kind/precedingCursor）
- ai-human-coop.test.ts +5（waitFor close 中途解除 ×2 + waitFor 已 closed 进入即返 ×1 + waitFor errored ×1 + SessionNotOpenError ×1 + SessionBase priority 透传 ×1，扣掉合并的 cleanup 实际净增 5）

