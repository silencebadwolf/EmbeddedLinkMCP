# LinkTerm First Success & AI Trust — Spec 评审

> **2026-07-15 产品覆盖决策**：本评审中的 Approval/Pause/Take Over 结论已被 observe-only
> 变更覆盖。当前要求是 AI 自动执行、用户只观察，且保留原有校验、串行写入、审计和信任边界。
> 详见 [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md)。

结论：**PASS**

- 评审日期：2026-07-11
- 评审范围：`00-idea-capture.md` 至 `04-agent-build-handoff.md`

## 摘要

本包已经把“首次使用更顺”和“AI 更可信”从宽泛目标拆成共享基础与九个独立里程碑（Phase 0–8），定义了用户旅程、UI 状态、数据模型、安全边界、阶段任务、测试、验证命令、验收标准和完成定义。四项关键决策已经由项目负责人确认，Phase 0 可继续完成独立 OpenSpec 和精确计划，而无需猜测主架构。

本评审升级为 PASS 的依据是四项产品策略已明确冻结：既定 Phase 顺序；desktop=`interactive-required`、headless=`headless-deny` 且首版不启用 `automation-allowlisted`；脱敏 durable audit 默认保留 30 天并按 10 MiB 轮转；Windows-first 手工验收并保持 macOS/Linux 核心自动化兼容。PASS 只表示规格包可进入逐阶段工程流程，不表示任何 Phase 已实现。

## 准备度清单

- [x] 产品目标清楚。
- [x] 目标用户与最小成功会话清楚。
- [x] A、D 的相互依赖和独立边界清楚。
- [x] 主要用户旅程、失败状态和重复使用行为已定义。
- [x] Serial ConnectionDraft、continuous firstSignal lifecycle 与 xterm completion-based actual-visible-device ack 已定义。
- [x] Approval step display summaries 与 known-good CompensationCandidate/reflash 边界已定义。
- [x] UI/design expectations 足以避免通用 dashboard 输出。
- [x] 需求使用稳定 ID 或明确验收条目，可测试。
- [x] 技术架构、拓扑、数据位置和 storage 推荐已记录。
- [x] 明确不需要 database、cloud auth、remote services。
- [x] Main/Renderer/MCP 的 trust boundary 已定义。
- [x] Approval 的 PreparedOperation/effect fingerprint、TTL、single use、TOCTOU 与 fail-closed 已定义。
- [x] logical operation 与 per-invocation CallAttempt 身份和终态已分离。
- [x] ApprovalMode 不随窗口、Renderer、transport 或请求降级。
- [x] Pause admission lease 与 running/Stop 边界已定义。
- [x] Broker authority、best-effort ledger 与默认开启但可关闭的 durable store 已分层。
- [x] Direct Control Profile download IPC、prepare read-only facade 与 Broker quota/backpressure 已纳入迁移和测试范围。
- [x] Shared-token stable principal、subject/surface/mode-bound grant 与 direct two-invocation continuation 已定义。
- [x] Main-only authorization/lease/compensation schema 与 Renderer-safe projection 已分离。
- [x] wrong consumer preserve-grant 与 correct-consumer effect supersede 的验证顺序已定义。
- [x] global/session Pause OR/Resume precedence 已定义。
- [x] 敏感数据与审计 redaction 边界已定义。
- [x] 实现阶段、构建任务和顺序已定义。
- [x] 测试层级和验证命令已包含。
- [x] 验收标准与 Done Means 具体。
- [x] 非目标可以阻止聊天 UI、云平台和大爆炸重构等范围漂移。
- [x] 用户确认四项关键决策后，新 Agent 可从 handoff 开始一个里程碑的 planning。
- [x] 用户已接受关键默认决策。
- [ ] 每个实际里程碑已有独立 OpenSpec change 和批准的实现计划。

## 规格一致性检查

### 产品与实现一致

- Design 要求任务优先；UI 使用 Start Center intent cards；实现以 FirstSuccessCoordinator/Readiness 驱动，三者一致。
- Design 把成功定义为 device text 真正 visible；UI 区分 open/silent/late/detected/visible；实现使用持续 ObservationMonitor + revisioned IPC + xterm completion 驱动的 `lastVisibleDeviceSequence`，三者一致。
- Design 要求 AI 动作 recorded/queryable、默认按 active/attention/task 聚合；UI 使用 Activity Center；实现以 OperationEvent/CallAttempt/ledger/recorder 支撑，三者一致。
- Design 要求真实人类审批；UI 使用 consequence card；实现将 broker 放在 main，并禁止 MCP resolve，三者一致。
- Design 要求人类接管；UI 定义 Pause AI changes、按 capability 命名的 stop control 和 Take Over；实现使用 epoch/ExecutionAdmissionLease、声明式 cancellation capability 和 human high lane，三者一致。

### 数据与隐私一致

- workspace 事实继续留在 `.linkterm/`。
- UX/pause/activity 放 Electron userData。
- approval grant 仅内存。
- activity 不复制 transcript/binary/secrets。
- 不需要 database、云端或远程 auth。

### 范围一致

- A、D 被拆成多个 change，handoff 明确禁止一次实现全文。
- Human Approval 在串口切片之后先迁移现有 MCP/direct Download 高影响入口；J-Link/RTT 再在 Broker 上扩展，不会先扩大“下载并观察”再返工授权。
- Approval 与 registry instrumentation 分开，符合 `registerTool` HIGH-risk blast radius。
- CI/characterization 只作为安全关键变更的门禁，不扩展为独立平台工程。

## 歧义与处理结果

### “连接成功”

已固定为四个不同 milestone：transport/session open、data received、signal visible、可选保存成功使用的 connection settings。不得再以 IPC `success=true` 或首字节已检测替代 journey success，也不把现有 profile 冒充稳定设备身份。

### “用户确认”

`confirm=true` 已固定为 caller acknowledgement，不是授权。Main 启动时冻结 `interactive-required | headless-deny | automation-allowlisted`；只有 human grant 或显式 allowlisted automation policy 能成为 authorization source，UI 不得把后者标成人类批准。

### “批准了什么”

已固定为 PreparedOperation 的实际效果，而不是原始路径/args：realpath、artifact 内容 hash/size、profile revision、默认值、probe/target 和精确步骤均进入 effect fingerprint。批准后任何变化都必须 mismatch，effectful backend=0；prepare 只读 allowlist 调用单独计数。

### “调用与操作”

已固定为 server logical `operationId` + per-invocation `callId`。首次 approval-required call 以 CallAttempt `approval-required` 结束而 operation 保持 awaiting；重试由 Broker 找回原 operation，避免状态倒退或 client 伪造关联。

### “停止”

已固定为 Pause admission、内部 cancel-requested/cancelled、failed/succeeded after request 和不可安全停止。Pause commit 后不再 admission 新 AI change，但已持有 execution lease 的 operation 可能继续；safe-point 才显示 Stop at safe point，best-effort 使用不同文案，none 不显示。不得承诺硬件 rollback。

Global 与 session Pause 已固定为 OR；两类 Resume 只清自己的 latch，session lease 同时复验 global/session epochs。

### “首次信号”

silent 已固定为非终态；Main 的 listener 在超时提示后继续，firstSignal 使用 Main-minted attemptId + revision 解决 status/event/reload 竞态。只有非空 device 文本经 xterm completion ack 后 `lastVisibleDeviceSequence` 才推进，不完整 UTF-8 或 state event 不算 visible。

“写入 terminal”已进一步固定为 xterm write completion callback/等价异步 ack，而非同步调用返回；delayed callback、dispose/unmount、replay exactly-once、ownsSession Edit/Disconnect cleanup 与 late-signal focus policy 均纳入测试。

### “执行入口”

Approval 不只覆盖 MCP registry；现有 Control Profile direct RUN/START_DOWNLOAD IPC 也必须使用同一 PreparedOperation/Broker。Download click 与硬编码 `confirm:true` 只发起 prepare。已选择两次-invocation continuation：`approval:resolve` 不执行，批准后同一 channel 只携 approvalId 继续；RUN=sync、START=background，reload 后显式 Continue，duplicate 不重执行。

### “谁能消费”

Shared Bearer 的 HTTP/stdio/new socket/reconnect 全部映射为一个 Main-assigned local-MCP principal，trusted Renderer 映射为独立 desktop principal。grant 同时绑定 subject + continuation kind/surface/mode；wrong consumer 的 effectful backend=0 且不作废，正确 consumer 仅一次。per-principal + global limiter 不能被重连绕过。

PreparedOperation、grant、AuthorizationRecord、principal、lease 和 CompensationCandidate 保持 Main-only；Renderer 只获得 ApprovalRequestView、AuthorizationDisplay 和 CompensationCandidateSummary。Automation 使用 `automation-initial` consumer binding，内部 rule 只投影 display-safe id。

### “资源边界”

PreparedOperation queue 已定义 pending/principal、artifact/total bytes、per-principal + global rate limits；HTTP/stdio reconnect 不能绕过，streaming hash 可取消，expiry/supersede/consume/stop/shutdown 按规则释放，超限稳定 fail closed。

### “审计”

已限定为脱敏 operation metadata + evidence refs，不是 terminal transcript 的永久副本。Broker 内存 `AuthorizationRecord` 是授权 authority；`ApprovalDecisionRecord` 与 `OperationReceipt` 是不同用户可见记录；OperationLedger 是 best-effort 观测投影，JSONL 是默认开启、可由用户关闭的异步副本，只承诺 authorization at-most-once。

### “完成整个计划”

已固定为全部 Phase + 项目级完成定义；单个里程碑只能声称该里程碑完成。

## 构建前必需修改

### Phase 0 当前门禁

1. [x] 用户接受推荐交付顺序。
2. [x] 用户审阅并记录 ApprovalMode/automation、持久审计和首发平台三项决定。
3. [x] 已创建 Phase 0 独立 OpenSpec change `establish-characterization-ci-gates`；本包不替代 change-level spec。
4. [x] 已完成并严格校验 Phase 0 proposal、delta spec、design 和 tasks；独立信任复审结论为 PASS。
5. [x] `writing-plans` 已重新检查当前 HEAD、工作树和 GitNexus index，并生成 `docs/superpowers/plans/2026-07-11-establish-characterization-ci-gates.md` 精确实现计划。

### 在 Phase 1 修改 registry 前

1. 对 `registerTool` 重新运行 upstream impact 并向用户报告 HIGH 风险。
2. 建立 success/handler error/version rejection/unexpected throw characterization tests，并单独验证 SDK pre-handler validation 不触发 effectful backend。
3. 冻结第一版 OperationEvent schema 和 redaction fixture。

### 在 Phase 5 开始前

1. 冻结 desktop/headless/automation 的 ApprovalMode 默认值、可信启动入口和 legacy client capability；窗口状态不得参与降级。
2. 完成现有 63-tool risk inventory，并对未知 state-affecting action fail closed。
3. 冻结 MCP schema/error migration 和兼容周期。
4. 定义 BrowserWindow sender 验证规则；无窗口时 interactive request 保持 pending/deny，不能 fallback。
5. 冻结 PreparedOperation/effect fingerprint 的输入、artifact snapshot/原子复验策略和 plan manifest。
6. 冻结 operationId/callId 两层状态机、ExecutionAdmissionLease，以及 Broker mandatory AuthorizationRecord 与 ledger/store fault protocol。
7. 冻结 prepare read-only backend allowlist、Broker quotas/backpressure/资源释放语义。
8. 点名迁移 `registerControlProfileIpc` 的 RUN/START_DOWNLOAD，验证 button/confirm-only effectful-backend=0 与 MCP/IPC single-use。
9. 冻结 stable CallerPrincipalId 映射、per-principal + global limiter，以及 subject/continuation-kind/surface/mode-bound grant/AuthorizationRecord。
10. 冻结 direct two-invocation continuation：resolve 不执行、RUN sync/START background、reload/duplicate/wrong consumer preserve-grant/close race。

### 在 Phase 8 开始前

1. 冻结 persistence API，并落实已确认的默认开启、30 天 retention 和 10 MiB rotation；用户仍可关闭和清除。
2. 定义 Export 路径隐私和用户预览。
3. 建立 terminal/activity 性能基线和可接受回归阈值。

## 可选改进

- 在 Phase 3 前基于 `02-ui-design-brief.md` 生成 2–3 个高保真 mockup，并将选择转写回文字要求。
- 为不同 MCP Agent 引入独立 actor credential/identity；当前单 token 不足以可信区分厂商。
- 在真实硬件矩阵可用后增加 Windows/macOS/Linux install-level smoke。
- 后续评估窄范围短时授权，但首版坚持 Approve once。
- 将成功会话生成 profile 的差异预览做成独立体验增量。

## 规格自审

### 占位符扫描

文档没有未填写章节、空模板项或需要 Agent 自行猜测的核心技术选择。开放事项均集中列出，并注明阻塞阶段。

### 内部一致性

独立审阅曾发现会阻塞安全实现的核心歧义：args-only approval 的 TOCTOU、operation/retry identity 冲突、窗口状态导致审批降级、Pause 与 running step 冲突、ledger/store 与授权 authority 冲突、internal schema 跨 IPC 泄露、wrong-consumer 与 supersede 冲突，以及同步 `term.write` 过早完成。本次修订已给出 PreparedOperation effect fingerprint、operationId+callId、immutable ApprovalMode、ExecutionAdmissionLease、Broker AuthorizationRecord、Main-only/safe DTO 分层、consumer 验证顺序、global/session Pause precedence 和 xterm completion ack；也补齐了 direct IPC continuation、stable principal、只读 prepare facade、precondition terminal mapping、Broker quota/backpressure、firstSignal lifecycle 与 ownsSession recovery。它们在 package 层语义已定义，但仍须在对应 OpenSpec/实现计划中冻结精确 API 与测试，不能仅凭本包视为代码已安全。

### 范围检查

整个计划过大，不适合作为单个实现计划；文档已经强制拆成九个 OpenSpec/plan/review 周期。第一个可执行单元是 Phase 0，不是 A+D 全文。

### 可测试性检查

每个安全关键要求都有 effectful-backend=0、principal/kind/surface/mode-bound single-use、direct continuation、TOCTOU、mode downgrade、reconnect-resistant quota/fault injection、admission race、redaction 或双状态机断言；每个主要 UI 状态有 renderer/手工测试要求；first signal 有 continuous/listen-before-status/revision/xterm-completion/UTF-8/ownsSession 条件。

## 结论说明

`PASS` 表示：

- 产品级规格与关键默认值已经审阅，可为 Phase 0 完成独立 OpenSpec 和精确计划；
- 不应该直接开始整个 A+D 实现；
- Phase 5/8 仍须在各自 OpenSpec 中冻结可信启动/legacy capability 与持久化 API，Phase 7 不得在 admission/running 与 global/session precedence 未冻结时进入；
- PASS 不授权跨阶段实现，也不把单个 Phase 完成视为 A+D 整体完成。

## Superpowers 交接推荐

1. 四项关键决策已记录；先完成并审阅 `establish-characterization-ci-gates` OpenSpec。
2. 对 Phase 0 调用 `writing-plans`，不要同时规划后续八个里程碑。
3. 实现时使用 `executing-plans` 或 `subagent-driven-development`。
4. 每个里程碑完成后请求代码审查并运行 completion verification。
5. 一个里程碑的实现反馈可以修订后续规格，但不得悄悄扩大当前 change。
