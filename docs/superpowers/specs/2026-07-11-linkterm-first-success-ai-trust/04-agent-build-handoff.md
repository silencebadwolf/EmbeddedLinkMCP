# LinkTerm First Success & AI Trust — Agent 构建交接

> **2026-07-15 产品覆盖决策（当前执行真源）**：AI 操作自动执行，Activity/Transcript/Audit
> 仅观察；不得实现批准弹窗、批准继续、Pause AI 或 Take Over。本文早期对应条目均为历史
> 设计，执行时以 [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md)
> 及其 OpenSpec 为准。

- 状态：Reviewed — Phase 0 handoff active
- 执行方式：必须拆成多个经批准的 OpenSpec change 和实现计划；禁止一次实现全文

## 任务使命

把 LinkTerm 的两个高价值体验方向交付为一组可逐步发布的能力：

1. 用户从打开应用开始，经环境/设备检查、任务选择和连接计划，在同一流程中确认首段非空设备数据已经在终端可见；失败时能原地理解并恢复。
2. 用户可以实时看见 AI 的动作、目标、风险、步骤和结果；interactive-required 的 approval-required operation 需要真实的一次性人类审批；用户可以 Pause AI changes、按 backend 声明的能力请求停止并接管 session。

实现必须保持 LinkTerm 现有安全边界：UI/MCP 写入统一经过 SessionManager→WriteQueue→Transport；J-Link 只经 IJLinkBackend；Renderer 不拥有审批或 secret。

## 产品愿景

LinkTerm 不只是拥有很多终端和 J-Link 工具，而是一个能让人和 AI 共同、安全地操作真实设备的本地工作台。新用户不需要先理解 transport、surface 和配置文件；熟练用户不被向导束缚；AI 自动化不能在人的视野之外修改设备状态。

## 用户体验目标

- 首次用户在一个连续流程中完成“扫描 → 明确选择 → 连接 → data received → signal visible”。
- `open`、`open but silent`、`data received but not visible`、`signal visible`、`UI subscribe failed` 和 `transport failed` 均有不同状态。
- AI 的 terminal、workspace、workflow、debug、UI 和 runtime 动作进入同一 Activity Center。
- approval-required 动作展示后果卡/完整计划，并由用户批准一次；AI 自带 `confirm=true` 不等于人类批准。
- 用户能 Pause AI changes；任务按声明的 cancellation capability 显示 Stop at safe point、Request stop (best effort) 或无按钮；并可 Take Over session，同时保留 human high-priority 输入。
- 所有记录 local-first、脱敏、可清除；终端主工作面和输入性能不退化。

## 不可协商需求

- 不绕过 SessionManager、WriteQueue、transport、IJLinkBackend 或现有 manager。
- Renderer 不得签发 ApprovalGrant；MCP 不得暴露 approve/resolve 工具。
- 每个逻辑 operation 使用 server-generated `operationId`，每次 MCP invocation 使用唯一 `callId`；approval retry 由 Broker 找回原 operation，client correlationId/id 只作不可信关联。
- Main 必须提供稳定 `CallerPrincipalId`：共享 Bearer 的 HTTP/stdio 映射为一个 runtime-credential principal，trusted Renderer 映射为独立 desktop principal；per-request connection/IP 不作为授权或唯一限流身份。
- grant 绑定 PreparedOperation 的实际效果指纹、authorized principal、continuation kind/surface/execution mode、runtime/expiry 且只能消费一次；wrong principal/kind/surface/mode 的 effectful backend=0 并保留原 grant 到 TTL。
- approval retry 必须有稳定 pending/approved/approved-but-paused/denied/expired/mismatch/consumed 契约；MCP 可以读取状态或重试，但不能 approve/resolve。
- 本文的 `backend=0` 专指 effectful/execution backend 调用为 0；prepare 只允许 policy allowlist 的只读 facade，并单独断言调用范围与次数。denied/expired/mismatch/replay 的 effectful backend 调用次数必须为 0。
- Control Profile direct `RUN_DOWNLOAD` / `START_DOWNLOAD` IPC 与 MCP 共用 PreparedOperation/Broker；Download click 或硬编码 `confirm:true` 只发起 prepare，不能签发 grant，不能跨 surface 双消费。
- `approval:resolve` 只记录决定、不执行；direct IPC 批准后用同一原始 channel + `{kind:'continue-approved', approvalId}` continuation。RUN 固定 sync，START 固定 background；Renderer reload 后显式 Continue，duplicate 不重执行。
- prepare 可调用 policy allowlist 的只读 detect/status/availability/catalog facade；connect/halt/run/reset/write/erase/flash/start-server 等副作用方法调用必须为 0。
- Broker 必须限制 pending 数、单 artifact/总 prepared bytes、per-principal 与 global rate；HTTP/stdio 重连不能绕过。超限 effectful backend=0，不淘汰 approved-unconsumed grant，并按 TTL/终态释放资源。
- risk policy 集中定义；未知 state-affecting action 不得默认为 read-only。
- ledger 在保存前做 allowlist redaction；不能只在 UI 层遮挡。
- 不保存 SSH 凭据、私钥、token、完整 firmware/binary/memory payload、原始 screenshot 或默认完整 Commander script。
- 不用脆弱的通用命令文本分类器声称任意 terminal write 已安全判级；首版用可见性、pause 与明确设备工具策略控制风险。
- activity 与 terminal/debug evidence 分层，不把 terminal data 逐字节复制到 timeline。
- readiness 只做只读检查；连接、配置写入、reset、flash 等必须有明确用户动作/授权。
- 串口计划必须展示端口独占、DTR/RTS/control-line 和潜在复位副作用；连接阶段不得主动发送 payload。
- 多设备或低置信候选不得静默选择。
- 当前计划不实现 checkpoint；若宿主/未来版本提供文件或 config checkpoint，必须明确覆盖边界。`OperationReceipt` 只是证据，不得宣传为恢复点或普通撤销。
- 补偿性 reflash 只有 Main 的 known-good CompensationCandidate source/hash/target binding 复验通过并重新获批时才可建议；不能从失败 OperationReceipt 猜测，也不能承诺恢复原状态。
- Main 启动时冻结 `ApprovalMode`：desktop 默认 `interactive-required`、headless 默认 `headless-deny`；窗口/Renderer/请求/transport 不能触发安全降级，automation 只能通过显式 allowlist 启动入口。
- PreparedOperation、ApprovalGrant、AuthorizationRecord、CallerPrincipalId、ExecutionAdmissionLease、CompensationCandidate 及 source ref/nonce/internal digest/bytes/handles 全部 Main-only；preload/Renderer 只接收显式 display-safe projections。
- 新 UI 同时支持中英文、键盘和非颜色状态表达。
- 实现前后遵循 AGENTS.md 的 impact/detect_changes 规则。

## 范围外内容

- Agent 聊天界面、模型选择器、prompt 管理器。
- 云账号、远程审批、多人 RBAC、跨设备同步或默认遥测。
- 通用 workflow designer、任意脚本自动修复、系统驱动安装器。
- 永久 Always Allow、approval-required operation 的全局白名单。
- 对 flash/erase/reset 的通用 rollback 承诺。
- 一次性重构所有大型历史文件。
- Mobile/web 产品版本。

## 技术架构

新增核心域并由 main composition root 注入：

1. `core/readiness`：聚合 serial/workspace/J-Link/runtime/agent 事实并生成候选。
2. `core/session/first-signal-observation`：用持续 listen + replay + 独立 silence timer 检测 device signal，不消费 Renderer subscriber cursor。
3. `core/activity`：OperationEvent schema、state machine、ledger、recorder、risk、redaction。
4. `core/approval`（可位于 activity 下）：PreparedOperation/effect fingerprint、ApprovalBroker、ApprovalModePolicy、mandatory AuthorizationRecord、limits、single-use grant。
5. `core/ai-control`（可位于 activity 下）：global/session pause epoch、OperationAdmissionCoordinator、ExecutionAdmissionLease。
6. `core/preferences`：版本化 recent workspace/dismissed hints/pause preference adapter，损坏数据回退安全默认值。

Main 通过 typed IPC 暴露 snapshot/event/resolve/control；MCP registry 旁路记录 tool lifecycle；JobManager 提供 progress/cancel；Renderer 使用独立 first-success 和 activity feature store/reducer。

```text
Renderer features
  ├─ Start Center / First Success
  ├─ Activity Center / AI Status
  └─ Approval / Pause / Take Over
             │ typed preload + IPC
Electron Main composition root
  ├─ RuntimeReadinessService
  ├─ OperationLedger / Recorder
  ├─ PreparedOperation / ApprovalBroker / ApprovalModePolicy / RiskPolicy
  ├─ OperationAdmissionCoordinator / AiControlPolicy
  └─ Preferences / AuditStore
             │
MCP registry + IPC + JobManager + SessionManager
             │
WriteQueue / Transport / IJLinkBackend
```

## 应用拓扑 / Surfaces

继续是单一 Electron 应用加本机 MCP runtime：

- Main Process：所有 runtime、安全策略、审计和文件访问。
- Renderer：展示、用户选择和可信 BrowserWindow 内的人类操作入口。
- MCP HTTP/stdio：Agent 调用入口；不能批准自己。
- Workspace files：现有 `.linkterm/` 工程事实源。
- Electron userData：UX preferences、pause state、可选脱敏 activity JSONL。

不增加云 API、worker、database 或远程服务。

## 数据模型

跨 main/preload/renderer 的 display-safe 边界模型必须实现并版本化：

- `RuntimeReadinessSnapshot` / `ReadinessCheck`
- `DeviceCandidate` / `ConnectionDraft`
- `FirstSignalObservation`（含 revision/updatedAt/silentSince）与 firstSignal start/status/stop DTO
- `OperationEvent` / `ActivityCursor` / `ActivitySnapshot`
- `CallAttemptPhase` / `CancellationCapability` / server `callId`
- `OperationActor` / `OperationTargetRef` / `EvidenceRef`
- `ApprovalCapabilitiesView`；risk display 从 safe `OperationRisk` + i18n policy 派生
- `ApprovalRequestView` / `AuthorizationDisplay` / `ApprovalDecisionRecord` / `OperationReceipt`
- `CompensationCandidateSummary`（不含 Main-owned source ref/target binding digest）
- `AiControlState`

以下 schema 必须版本化，但严格限制在 Main/Broker 内部：

- `CallerPrincipalId` / `PreparedContinuation` / `ConsumerSurface`
- `RiskPolicyEntry` / `ApprovalModePolicy` / `ApprovalBrokerLimits`
- `PreparedOperation` / internal `ApprovalRequest` / `ApprovalGrant` / `AuthorizationRecord`
- `CompensationCandidate` / `ExecutionAdmissionLease`

`FirstSuccessViewState` 是 renderer-local 派生态，不做第二个边界 schema，也不整体持久化。

详细字段、safe mapper 与状态机见 `03-implementation-spec.md`。所有边界 payload 经 Zod/等价严格 schema 校验；禁止为方便调试把 internal object spread 到 IPC。

## Database / Storage 推荐

不引入 database。

- 实时 operation：内存有界 ring buffer，支持 snapshot/cursor/truncated；它是观测投影，不是 approval authority。
- 持久 activity：后期加入 Electron userData JSONL，默认开启、保留 30 天并按 10 MiB 轮转，用户可关闭和清除。
- PreparedOperation、internal ApprovalRequest、approval grant、mandatory AuthorizationRecord 和 ExecutionAdmissionLease：Main/Broker 内存，受 quota、短时、一次性或 operation lifetime、重启失效；prepared artifact bytes/handles 不进入导出。
- CompensationCandidate：Main 内存，仅来自同 target 上一次 verified successful deployment，保存 main-owned source ref/hash/target binding，不从失败 OperationReceipt 推断，重启失效。
- pause state/UX preference：版本化 userData JSON。
- workspace/profile：继续使用现有 `.linkterm/` 与 manager。
- credentials：继续 main-owned safe storage/瞬时 payload，不进入 activity。

不选择 SQLite 的原因：当前查询需求是最近时间线、按有限字段筛选和导出；JSONL + 有界内存足够，减少 native/迁移成本。若后续出现百万级历史、复杂聚合或多用户，再单独评估。

## Hosting / 数据位置 / 部署

- 全部数据默认留在本机。
- 不发送遥测、operation、terminal、workspace path 或设备标识到云端。
- Export 由用户明确触发，并在保存前显示字段预览/脱敏结果。
- 按现有 electron-builder 继续打包 Windows/macOS/Linux；MVP 手工验证推荐 Windows。

## 平台目标

- MVP：Windows Electron desktop + 本机 MCP host。
- 自动化兼容：Windows/macOS/Linux core、renderer、IPC 和 fake backend tests。
- 后续：macOS/Linux 实机/安装级验证，取决于发布要求。
- 明确不做 mobile/web UI。

## 技术栈推荐

| 领域 | 默认值 |
| --- | --- |
| Frontend | 现有 React + Vite + Radix primitives + Tailwind |
| State | first-success / activity 独立 reducer/store；不继续膨胀 app-store |
| Runtime | TypeScript/Electron main，纯 core service + injected adapters |
| Validation | 现有 Zod/严格 TypeScript schema |
| Realtime | IPC snapshot + event + cursor；不引入 WebSocket |
| Persistence | 本机 JSON/JSONL；不引入 database |
| Auth | 本机 single-user；MCP 保留现有 token，actor identity 不信任自报名称 |
| Jobs | 复用 ControlWorkflowJobManager/AbortSignal；另由 backend/job 声明 cancellation capability，不把 AbortSignal 等同 safe point；不引入 queue service |
| Search | 内存过滤最近 activity；不引入全文搜索引擎 |
| Observability | 本地 OperationEvent、drop diagnostic、可选 export |
| Testing | Vitest unit/integration/happy-dom + fake hardware +有限手工实机 |
| CI | lint、build、test、license；coverage 先报告再设门槛 |

## Auth / Secrets / Sharing 模型

- Main Process 是 approval authority。
- BrowserWindow sender 必须验证，`ui_configure` 不能操作审批控件。
- ApprovalMode 由可信启动入口冻结；窗口关闭/隐藏/崩溃不能把 interactive-required 降级为仅有 caller/client acknowledgement。
- shared-token HTTP/stdio/new socket/reconnect 均映射同一 local-MCP principal；Renderer principal 独立且由 Main sender mapping 产生。grant/limit 不信任 client 自报 identity。
- MCP token 证明本机访问权限，不证明具体 Agent 身份；第一版 UI 显示 transport/本机 Agent，不虚构 Copilot/Claude 身份。
- 若未来需要 per-Agent identity，使用每 integration 独立 credential/handshake，另立规格。
- 没有公共分享、远程 viewer 或 cloud admin。
- Export 不包含真实 secret；不得把 approval nonce 暴露为长期 token。

## 集成

- Electron IPC/preload
- MCP HTTP/stdio registry
- Control Profile direct `CONTROL_PROFILE_RUN_DOWNLOAD` / `CONTROL_PROFILE_START_DOWNLOAD` IPC
- SessionManager / SessionBase / WriteQueue / TranscriptBuffer
- SerialDiscovery 与 transport adapters
- WorkspaceConfigManager / ControlProfileManager / RecordManager
- IJLinkBackend / JLinkAdapter / device catalog
- ControlWorkflowJobManager / workflow step update / AbortSignal
- Renderer App/ConnectionDialog/ControlProfilePanel/SessionHydration/OriginIndicator
- i18n en/zh
- GitNexus impact/PDG/detect_changes workflow

## 实现阶段

### Phase 0：Characterization 与 CI

- 目标：锁定现有 registry、confirmation、session errored 和 job 行为。
- 任务：建立 `establish-characterization-ci-gates` OpenSpec，补 tests、63-tool risk inventory、CI/coverage provider。
- 验证：无产品行为变化，全量现有检查通过。

### Phase 1：Operation Ledger

- 目标：所有进入 handler 的 MCP 动作有旁路、可查询 lifecycle。
- 任务：逻辑 Operation + per-invocation CallAttempt schema/state、redactor/ledger/recorder，registry + JobManager 接入，activity IPC。
- 验证：每个 `callId` 唯一 terminal，operation/call 身份不混淆，cursor/reload、敏感字段、业务结果不变；state-machine fixture 支持未来 approval retry，生产 continuation 到 Phase 5 才启用。

### Phase 2：Activity Center

- 目标：AI 的终端与非终端动作和 workflow steps 对用户可查、重点可见。
- 任务：status capsule、drawer、active/attention/task 默认聚合、read-only burst 折叠、filters、Go to session/Diagnose/Copy summary、origin entry、AI session non-stealing behavior。
- 验证：100% 保留期内 queryable、默认不逐 call 制造顶层卡片、real-time、snapshot、a11y、large list、terminal performance。

### Phase 3：Readiness + Start Center

- 目标：任务导向首次入口。
- 任务：提取通用 app/serial/可选 workspace readiness、Serial ConnectionDraft/candidate resolver、generation/event IPC、版本化 preferences、Start Center、manual port。
- 验证：0/1/multi/error/loading/profile、draft round-trip/source/side effects、preferences corruption/migration、重叠 refresh、热插拔、候选消失/重排状态矩阵；M4 前 CTA 回退现有 ConnectionDialog 或 feature flag。

### Phase 4：Serial First Signal

- 目标：完成第一条 A 纵向路径。
- 任务：plan review、connect、持续 ObservationMonitor + revisioned firstSignal IPC、xterm completion-driven lastVisibleDeviceSequence 闭环、silent/late/reload/ownsSession recovery/attempt cleanup、conditional focus、optional connection profile。
- 验证：open/errored/data detected/xterm-completion visible/silent→late/status-event race/reload/UTF-8 partial/subscribe failure/replay/delayed ack/dispose/ownsSession action visibility/edit-disconnect-back/user-vs-transport reason/retry/late event isolation/conditional focus/listener cleanup。

### Phase 5：Human Approval

- 目标：interactive-required 的 approval-required operation 必须有真实人类一次性批准，且授权不能被 TOCTOU 或窗口状态绕过。
- 任务：risk policy、read-only prepare facade、PreparedOperation/effect fingerprint、stable CallerPrincipalId、subject+continuation-kind/surface/mode-bound Broker/AuthorizationRecord/quotas、immutable ApprovalMode、internal→safe DTO mappers、完整 plan sheet、pending dedupe/queue、caller/human/automation source labels、`automation-initial` consumer binding、approval IPC、capability/schema/error/version；点名迁移 MCP 和 Control Profile direct RUN/START_DOWNLOAD 两次-invocation continuation。
- 验证：confirm-only/button-click-only、deny、expiry、正确 consumer 的 effect supersede、consumed replay、wrong principal/kind/surface/mode、quota 的 effectful backend=0；错误 consumer 不作废 grant；副作用 prepare method=0；artifact/path/symlink/profile/default/probe/target 变化 fail closed；RUN sync/START background、approve→reload→Continue、duplicate invoke；HTTP/stdio reconnect 不绕 limiter；正确 subject 仅一次，另一 surface 为 0，资源按各终态释放；Main-only 字段不跨 IPC。

### Phase 6：Workspace + J-Link/RTT

- 目标：在 Phase 5 Broker 上复用同一模型完成 download + observe。
- 任务：readiness blockers、job steps、specialized diagnostics、profile suggestion、Main-only known-good CompensationCandidate + safe summary；所有新 Download/Flash CTA 先经 Broker。
- 验证：backend/probe/target/firmware/flash/verify/RTT silent 全路径；只有 source/hash/target 仍匹配的 verified candidate 可准备 reflash，且所有新增高影响入口有 human-once/single-use 证据。

### Phase 7：Pause / Stop / Take Over

- 目标：用户恢复控制。
- 任务：epoch/OperationAdmissionCoordinator/ExecutionAdmissionLease、global OR session `Pause AI changes`、各自 Resume precedence、三档 cancellation capability、takeover。
- 验证：Pause vs lease acquisition 线性化；session Resume 不能越过 global Pause，global Resume 不清 session Pause，session lease 复验两层 epoch；awaiting/approved/queued blocked，running plan 可继续且明确提示；double release/restart invalidation；human high lane、read-only policy、no fake rollback、按钮文案与 capability 一致。

### Phase 8：Durable Audit 与产品化

- 目标：复盘、导出、隐私、性能、a11y、文档。
- 任务：JSONL、rotation、retention、export/clear、crash recovery、10k event performance、docs。
- 验证：redaction、interrupted state、全质量门禁、实机演示。

## 构建任务

每项必须由 writing-plans 再拆成具体文件/测试/命令；这里给出执行顺序。

1. 创建并批准 `establish-characterization-ci-gates`，完成 Phase 0 tests/risk inventory/CI。
2. 创建并批准 `add-operation-event-ledger`。
3. 实现 Operation/CallAttempt schema、precondition/restart state machine、cursor 和 redactor tests。
4. 实现 memory ledger/recorder；对 registry 修改前运行 HIGH-risk impact 并报告。
5. 建立 activity snapshot/event IPC 与 preload contract。
6. 构建 Activity Center，接入默认 task grouping、read-only folding、三类上下文动作、workflow steps 和 origin navigation。
7. 提取 RuntimeReadinessService/preferences，保持 MCP get_app_status 使用同一 provider。
8. 实现 ConnectionDraft/candidates/readiness/Start Center，补 manual serial path。
9. 实现持续 first-signal monitor、revisioned IPC、visible-device ack 和原地恢复。
10. 建立 RiskPolicy、read-only prepare facade、PreparedOperation/effect fingerprint、CallerPrincipalId、subject/continuation-kind/surface/mode-bound Broker limits/AuthorizationRecord、safe DTO mapper 和 ApprovalModePolicy。
11. 逐批迁移 MCP、Control Profile direct download two-invocation continuation、workflows/runtime restart 等 approval-required surfaces。
12. 在 Broker 上扩展 workspace/J-Link/RTT，不复制状态模型或新增授权捷径。
13. 实现 AI pause/admission lease、cancellation capability、Take Over。
14. 实现 durable audit/export/clear/crash recovery。
15. 完成 a11y/i18n/performance/CI/docs/release gate。

## 测试要求

### Unit tests

- readiness aggregation、partial errors、abort、candidate confidence、ConnectionDraft/preferences、CompensationCandidate known-good replacement/expiry。
- first-success reducer、continuous ObservationMonitor/revision/lifecycle/cleanup、attempt isolation、UTF-8 + xterm completion visible-device ack、ownsSession action semantics。
- operation/call-attempt precondition/retry/restart transitions、first request/retry/duplicate/concurrent retry、terminal state、out-of-order、cursor truncation。
- risk inventory、read-only prepare allowlist、effect fingerprint/limits、display-safe step summaries/internal-safe projection、principal mapping、continuation binding/validation order、AuthorizationRecord atomicity、ApprovalMode immutability、approval TTL/single-use/replay。
- redaction credentials/binary/script/path/token/property/fuzz fixtures。
- pause global-OR-session precedence、epoch/admission lease/lock ordering/double release、blocked/running boundary 与 persistence。

### Integration tests

- registry→ledger 的所有 return/throw/version/schema paths；每次 call 唯一 terminal，approval-required call 不把 operation 标为 running。
- MCP→approval→renderer human resolve→retry→backend。
- Control Profile RUN/START_DOWNLOAD IPC→prepare/sheet/grant→backend；button/confirm only 的 effectful backend=0，MCP/IPC 不双消费。
- HTTP new socket/reconnect/stdio proxy loop 仍命中同一 local-MCP principal/limiter；wrong principal/kind/surface/mode 不消费且不作废，正确 consumer 一次成功。
- denied/expired/changed effect/replay 的 effectful backend=0；artifact content/symlink/profile/default/probe/target TOCTOU；wrong consumer preserve-grant。
- ApprovalMode 对 window close/minimize/crash、stdio/http、MCP reconnect、legacy client、伪造 header/args 均不可降级。
- AuthorizationRecord/ledger/store/quota fault injection、并发双消费、consume 后 backend throw/runtime crash，验证 at-most-once authorization 与资源释放。
- JobManager progress/list/subscribe/cancellation capability/internal cancel race。
- session human/AI ordering + pause/takeover + high lane。
- serial open/errored/data-before-return/data-before-mount/detected-but-not-visible/replay/silent→late/status-event/reload/UTF-8 partial/xterm delayed ack/dispose/ownsSession edit-disconnect/back-to-session/focus/retry。
- renderer snapshot/listen hydration 无丢失/重复；默认 grouping/folding 与 Go to session/Diagnose/Copy summary。

### Renderer tests

- Start Center、RecoveryActions 与 UI brief 状态矩阵；reflash 仅由有效 CompensationCandidate 驱动，Renderer 只见 Summary。
- manual port、多候选、plan review、recovery。
- Activity filters/details/progress/unknown/interrupted。
- Approval focus/expiry/deny/changed request/queue/rate limits/expired-not-reviewed、精确 range/verify semantics，以及 caller/human/automation 三种非颜色标签和 display-safe rule id。
- keyboard/screen reader/reduced motion/en/zh/small window。
- AI-created session 不打断正在输入的人。

### End-to-end / Manual

- 串口 first success 实机/可控 fake demo，含 silent→late、reload、UTF-8 partial、xterm completion、dispose 与 ownsSession 清理。
- AI 与 direct Download IPC 分别执行 prepare→plan→approve/deny/expire/change effect/quota；confirm/button only 的 effectful backend=0。
- Pause、Stop at safe point / Request stop (best effort)、Take Over。
- App/renderer/runtime restart recovery。
- Audit export preview/redaction/delete。

## 验证命令 / 检查

```powershell
pnpm run lint
pnpm run build
pnpm test
pnpm run validate:licenses
pnpm audit --prod
node .gitnexus/run.cjs analyze
```

此外：

- 修改任意 symbol 前运行 upstream impact。
- `registerTool` 当前风险 HIGH，必须先报告 blast radius。
- 安全关键更改使用 PDG/taint 定向检查，但不把 0 findings 当安全证明。
- 提交前执行 `detect_changes({scope: "all"})`，回归 review 对比 `main`。
- 每个 OpenSpec change 只允许覆盖一个里程碑。

## 验收标准

- [ ] 用户可从无 session 状态完成串口扫描、明确选择、连接，并让首个非空设备信号在 terminal 可见。
- [ ] 多设备不静默选择；无设备可 refresh/manual/diagnose。
- [ ] open、silent、data received、signal visible、subscribe failure、errored、disconnect 独立表达。
- [ ] silent 非终态；firstSignal attempt/revision/listen-before-status/reload/stop cleanup 闭合，只有 xterm completion ack 推进 visible，不完整 UTF-8/state event/delayed ack/dispose 不会误判。
- [ ] Keep waiting、Disconnect and edit、Back to session、Disconnect 按 ownsSession 规则显示并清理 monitor/session/port；user/transport/session-closed 不混淆，late signal 不无条件抢走其他 surface 焦点。
- [ ] Serial ConnectionDraft 在 candidate/plan/advanced form/session create 间无损 round-trip，保留 source 和 exclusive/control-line/reset/no-payload metadata。
- [ ] 成功连接可选保存现有 schema 支持的连接参数，保存不是完成前置，也不冒充稳定设备身份。
- [ ] `Prepare reflash of previous firmware…` 只由同 target 的 known-good verified CompensationCandidate 驱动，source/hash/target 复验失败即隐藏，点击重新审批。
- [ ] ObservationMonitor 不推进 TerminalView subscriber cursor；提前到达的数据仍只渲染一次。
- [ ] 终端与非终端 AI 工具和 workflow steps 在 Activity Center 可查询；默认只突出 active/attention/task groups，read-only burst 折叠，并提供 Go to session/Diagnose/Copy summary。
- [ ] 每个进入 LinkTerm handler 的 MCP 调用有唯一 server `callId` 和 terminal CallAttempt；approval retry 复用 Broker 找回的逻辑 `operationId`；SDK pre-handler validation 单独记录诊断。
- [ ] pre-admission reject/Pause/restart 有明确 operation 终态/恢复映射，不遗留永久 requested/blocked，也不误标 interrupted。
- [ ] `interactive-required` operation 仅凭 confirm=true 无法执行；窗口/Renderer/transport/legacy client 不能改变 Main 冻结的 ApprovalMode。
- [ ] HTTP/stdio/reconnect 使用稳定 local-MCP principal，Renderer 使用独立 Main-assigned principal；dedupe/rate/grant 不依赖 per-request connection。
- [ ] MCP 与 Control Profile direct RUN/START_DOWNLOAD IPC 都经 PreparedOperation/Broker；approval:resolve 不执行，button/confirm 不授权；grant 绑定 principal/continuation kind/surface/mode，wrong consumer 的 effectful backend 为 0 且不作废，正确 consumer 一次。
- [ ] Approval grant 绑定 PreparedOperation effect fingerprint、短时、一次性；artifact/path/symlink/profile/default/probe/target 变化、拒绝/过期/重放/quota 都不触发 effectful backend，prepared 资源按策略释放。
- [ ] Pause commit 后尚未 admission 的 AI changes 被阻止；awaiting/approved/queued 与 ExecutionAdmissionLease/running 清晰区分，human/system/允许的 read-only 正常。
- [ ] global/session Pause 使用 OR；global/session Resume 各自只清自己的 latch，session lease 同时复验两层 epoch。
- [ ] Main-only approval/authorization/principal/lease/compensation 对象不跨 preload，Renderer-safe DTO 不含 source ref、nonce、internal digest 或 raw rule 配置。
- [ ] caller acknowledgement / human approval / automation rule authorization 有不同可访问标签。
- [ ] 三档 stop control 与 backend capability 一致；内部 cancel-requested/cancelled 与 OperationReceipt/不可逆后果不混淆。
- [ ] activity persistence/export 不泄露受保护 fixture。
- [ ] terminal 吞吐和交互没有可感知退化。
- [ ] en/zh、keyboard、screen reader、reduced motion 和小窗口通过验收。
- [ ] lint/build/test/license/audit/CI/GitNexus 范围检查有新鲜证据。

## 完成定义

Agent 只有在以下全部满足时才能说相应里程碑完成：

- [ ] 已批准的 OpenSpec 和实现计划范围全部实现，无未解释跳项。
- [ ] 新增/修改的边界有自动化 tests，关键回归有 characterization。
- [ ] 所需质量命令以新鲜输出通过。
- [ ] 必需手工/实机检查完成；不可用项明确说明，不能静默省略。
- [ ] 安全测试证明未授权 backend 调用为 0。
- [ ] 敏感数据 redaction 通过 fixture/导出检查。
- [ ] 文档、schema/error/version/i18n/帮助同步。
- [ ] `detect_changes` 只显示预期 symbols/processes。
- [ ] 已请求代码审查并处理有效反馈。
- [ ] 已知限制和后续里程碑记录清楚。

A + D 整体只能在全部 Phase 完成并通过 `03-implementation-spec.md` 项目级完成定义后宣称完成。

## 已知风险

- `registerTool` 是 HIGH-risk hub；旁路观测与授权迁移必须分开。
- 日志可能变成 secret 仓库；必须写前 redaction、默认摘要和可清除。
- 单一 MCP Bearer token 无法可信区分 Agent 厂商。
- approval 过多会产生疲劳；首版只要求 approval-required，并使用 plan-scoped grant 与 pending dedupe/queue。
- 路径参数可能在批准后变化；必须 prepare 内容/目标并绑定 effect fingerprint，不能批准后静默重读。
- Control Profile direct download IPC 可能绕过 registry；必须点名迁移并做 button/confirm-only effectful-backend=0 与跨 surface single-use 测试。
- Prepared artifact queue 可能造成内存 DoS；必须设置 pending/bytes/rate quotas、streaming hash/abort、TTL/终态释放和稳定 backpressure。
- operationId 与 retry call 容易混淆；必须使用 logical operation + per-invocation call 双状态机。
- stateless transport identity 不稳定；必须以 runtime credential/desktop sender 映射 stable principal，并叠加 global limiter。
- direct IPC continuation 若不固定会产生重复执行；明确两次 invocation、RUN sync/START background、resolve 不执行与 duplicate outcome。
- ApprovalMode 若依赖窗口状态会产生降级；必须由 Main 启动时冻结。
- Pause/Stop 有并发和不可逆硬件边界；使用 admission lease，并诚实表达 running operation 可能继续。
- Broker、ledger、durable store 可能状态分裂；Broker AuthorizationRecord 是 authority，ApprovalDecisionRecord/OperationReceipt/其他 store 分层并做 fault injection。
- 串口/J-Link 不能可靠自动配对；候选必须有证据/置信度。
- silent firmware 可能合法；超时只提示且 monitor 继续，late signal 仍能完成。
- Activity 高频事件可能影响 terminal；不得逐字节记录，必须有性能预算。

## 已确认问题

- 已接受 Phase 0 → Ledger → Activity → Readiness → Serial → Human Approval → J-Link/RTT → Pause/Take Over → Audit 的顺序。
- 已接受 desktop=`interactive-required`、headless=`headless-deny`；首版不启用 `automation-allowlisted`。
- 已接受脱敏 durable audit 默认开启、保留 30 天、单文件 10 MiB 轮转。
- 已接受 Windows-first 手工验收，同时保持 macOS/Linux 核心自动化兼容。

窗口失焦时是否发送脱敏 OS approval notification 仍是可选 UX 决策。四项关键产品默认值已经审阅并冻结；可信启动入口/legacy capability 和持久化 API 的精确设计分别留给 Phase 5/8 的独立 OpenSpec。

## 给构建 Agent 的提示词

```text
你正在实现 LinkTerm First Success & AI Trust 计划。

首先完整阅读本交接文件及同目录的 01-design-doc.md、02-ui-design-brief.md、03-implementation-spec.md、05-spec-review.md，并检查目标仓库。不要立即编码，也不要把全文当成一个 change。

从最早尚未完成的里程碑开始：创建或审阅对应 OpenSpec，使用 writing-plans 把它拆成精确文件、符号、测试、命令、预期结果和风险。严格保持本交接的范围与非目标。修改任何函数/类/方法前遵循 AGENTS.md 运行 GitNexus upstream impact；HIGH/CRITICAL 必须先报告。增量实现并验证，每个阶段单独 review。不得让 Renderer 掌握审批 authority，不得把 confirm=true 当人类批准，不得把 terminal 全文复制进 activity，也不得宣称硬件副作用可普通 undo。

实现后运行所需 lint/build/test/license/audit 和 GitNexus detect_changes，提供新鲜证据；没有通过验收标准与 Done Means 前不得声称完成。
```

## Superpowers 构建交接

在本文件上使用 Superpowers 工作流：

1. `using-superpowers` 路由工作。
2. `writing-plans` 检查仓库，并把一个已批准里程碑转成精确任务、文件、命令、测试和期望结果。
3. `executing-plans` 或 `subagent-driven-development` 实现已批准计划，不扩大范围。
4. `requesting-code-review` 评审实现。
5. `verification-before-completion` 用新鲜证据证明验收条件。

不得从本文件直接跳到全部功能实现；每次只交付一个可验证里程碑。
