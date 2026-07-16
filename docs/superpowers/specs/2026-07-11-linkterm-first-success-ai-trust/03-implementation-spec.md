# LinkTerm 首次成功与 AI 可信协作 — 实现规格

> **2026-07-15 产品覆盖决策**：高影响 AI 操作不再等待人类批准或暂停状态；保留 Main 校验、
> admission、WriteQueue、后端边界和审计观察。本文中的 Approval Broker、Pause/Take Over
> 方案属于历史路线，当前实现规格以
> [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md) 为准。

- 状态：Reviewed — Phase 8 implementation complete；项目级最终人工审计待完成
- 文档角色：技术实现策略与分阶段路线图；不是本轮编码授权
- 前置：先审阅 `01-design-doc.md` 与 `02-ui-design-brief.md`

## 1. 实现目标

在保持现有 Electron main-owned runtime、SessionManager/WriteQueue 安全边界和 MCP 契约的前提下，新增两类可复用能力：

1. **Readiness + First Success**：统一环境/工作区/设备事实，驱动任务导向向导，并把成功终点从 `session=open` 提升为首段非空 device 文本经 xterm 异步确认后可见。
2. **Operation + Trust**：统一记录 MCP/IPC/workflow 动作，提供 Activity Center、风险策略、人类审批、AI pause/capability-aware stop/takeover 和脱敏本地审计。

不得通过在 `App.tsx`、`ConnectionDialog.tsx` 或每个 MCP tool 中散落更多局部状态完成。

## 2. 当前架构基线

### 可直接复用

- `src/core/session/session-manager.ts`：会话注册、水合、read/write/waitFor、subscriber cursor。
- `src/core/session/session-base.ts`：所有 AI/human write 经 WriteQueue；audit callback 已把 origin 和 correlationId 写入 transcript。
- `src/core/write-queue/`：human high lane 可作为紧急接管底座。
- `src/core/transcript/`：append-only、sequence、snapshot/readSince、truncated 恢复。
- `src/transports/serial/serial-discovery.ts`：枚举、热插拔和稳定设备元数据。
- `src/core/workspace/`：workspace/control profile schema 与 manager。
- `src/mcp/registry.ts`：63 个工具共享的 schema/version/result/error 边界。
- `src/mcp/surfaces/control-workflow/job-manager.ts`：job 状态、AbortSignal、cancel、update、retention。
- `src/mcp/surfaces/control-workflow/types.ts`：step status、duration、evidence、blockingReasons、nextActions。
- `src/mcp/surfaces/agent-runbook/tools.ts`：已有 app status 汇总逻辑，可提取为共享 readiness。
- `src/renderer/hooks/useSessionHydration.ts` 与 `useTranscript.ts`：snapshot + event 水合模式。
- `src/renderer/components/OriginIndicator.tsx`：可升级为 Activity Center 的 session-filter 入口。

### 已知必须修复的语义

- `session:create` 在 transport open 失败时可能返回 `success=true, state='errored'`；首次流程不能把 IPC success 当 journey success。
- `useSerialDiscovery` 当前不区分空列表与扫描异常。
- `SerialPortPicker` 会在有候选时自动选择第一个，空列表没有 refresh/manual input。
- `useTranscript` subscribe 失败当前无法与静默设备区分。
- AI 创建 session 的 `createdBy` 没有持续进入 Renderer `SessionMeta`，且新 session 可能抢焦点。
- `registerTool` 的 client `correlationId` 可选且不可信，不能替代 server-generated operationId。
- 当前高影响 `confirm=true` 只是一项调用契约，不能作为 human approval grant。
- `registerControlProfileIpc` 的 direct RUN/START_DOWNLOAD 路径会硬编码 `confirm:true` 并直接启动 workflow，不经过 MCP registry；M5 必须点名迁移。
- 当前 `SessionManager.waitFor` timeout 后移除 listener，不能单独实现 silent→late signal；ObservationMonitor 需要持续 listener 或从 last cursor re-arm。
- 当前 terminal render helper 没有“device 文本已实际写入”的 ack；最后处理 sequence 不能替代 `lastVisibleDeviceSequence`。

## 3. 目标架构

```text
┌──────────────────────── Renderer ───────────────────────────┐
│ StartCenter     ActivityCenter     ApprovalSheet            │
│ useReadiness    useOperations      useApprovals             │
└─────────────── preload typed API / IPC events ──────────────┘
                              │
┌──────────────────── Electron Main Process ──────────────────┐
│ RuntimeReadinessService    OperationLedger / Recorder       │
│ DeviceCandidateResolver    ObservationMonitor               │
│ PreparedOperation/Broker   ApprovalModePolicy               │
│ AdmissionCoordinator       AiControlPolicy / Leases         │
│ AuditStore/Redactor        Preferences / IPC adapters       │
│                                                            │
│ Existing composition root: registerIpcHandlers             │
│ Existing managers: Session / Workspace / JLink / Jobs       │
└───────────────────────────┬────────────────────────────────┘
                            │
              MCP registry / IPC / workflow updates
                            │
       SessionManager / WriteQueue / Transport / J-Link
```

核心服务保持 Electron-independent；只有 main adapter 获取 `app.getPath('userData')`、BrowserWindow 和 IPC。

## 4. 数据契约

### 4.1 RuntimeReadinessSnapshot

```ts
type ReadinessStatus =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'action-required'
  | 'blocked'
  | 'unavailable';

interface ReadinessCheck {
  id: string;
  scope: 'runtime' | 'workspace' | 'serial' | 'jlink' | 'firmware' | 'agent';
  status: ReadinessStatus;
  severity: 'info' | 'warning' | 'error';
  summary: string;              // stable i18n message key preferred at core boundary
  evidence: ReadonlyArray<ReadinessEvidence>;
  recommendedActions: ReadonlyArray<ReadinessAction>;
  checkedAt: string;
}

interface RuntimeReadinessSnapshot {
  schemaVersion: '1.0.0';
  snapshotId: string;
  generation: number;            // latest generation wins
  workspaceRoot?: string;       // renderer receives display-safe form
  checks: ReadonlyArray<ReadinessCheck>;
  deviceCandidates: ReadonlyArray<DeviceCandidate>;
  reusableSessions: ReadonlyArray<SessionSummary>;
  reusableProfiles: ReadonlyArray<ControlProfileRecordSummary>;
  blockers: ReadonlyArray<string>;
  generatedAt: string;
}
```

`summary` 不应在 core 中硬编码最终中英文长文案。推荐 core 返回 code + params，由 renderer 翻译；技术 details 保持脱敏。

### 4.2 DeviceCandidate

```ts
interface DeviceCandidate {
  id: string;
  kind: 'serial' | 'jlink' | 'saved-profile';
  label: string;
  confidence: 'exact' | 'likely' | 'unknown';
  evidence: ReadonlyArray<{
    source: 'live-discovery' | 'workspace-profile' | 'saved-record' | 'device-catalog';
    summary: string;
  }>;
  requiresUserConfirmation: boolean;
  connectionDraft: ConnectionDraft;
}
```

串口与 J-Link probe 不能仅凭列表位置或名称自动视为同一块板。任何推断都要展示证据与置信度。

Serial MVP 必须定义可在候选、plan review、ConnectionDialog prefill 和 session create 之间无损传递的 draft：

```ts
type DraftValueSource = 'user' | 'live-discovery' | 'saved-profile' | 'workspace-profile' | 'default';

interface SerialConnectionDraft {
  schemaVersion: '1.0.0';
  kind: 'serial';
  candidateId?: string;
  savedProfileId?: string;
  port: string;
  baudRate: number;
  mode: SerialMode;
  dataBits: SerialDataBits;
  stopBits: SerialStopBits;
  parity: SerialParity;
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
  sourceByField: Partial<Record<
    'port' | 'baudRate' | 'mode' | 'dataBits' | 'stopBits' | 'parity' | 'rtscts' | 'xon' | 'xoff',
    DraftValueSource
  >>;
  connectionBehavior: {
    opensExclusive: true;
    sendsPayloadOnConnect: false;
    controlLineBehavior: 'transport-default' | 'explicit-config';
    mayResetTarget: boolean | 'unknown';
  };
}

type ConnectionDraft = SerialConnectionDraft; // M6 may add a versioned J-Link union member
```

`toSerialSessionConfig(draft)` 只映射现有 `SerialSessionConfig` wire fields；plan-only behavior 不得伪装成 transport 参数。向 ConnectionDialog prefill 再返回 draft 必须保留 source/behavior metadata；M4 禁止把 `sendsPayloadOnConnect` 变为 true。DTR/RTS 实际默认值若当前 transport 不可配置，UI 必须显示为 transport-derived/unknown，而不是虚构精确设置。

### 4.3 FirstSignalObservation

```ts
type FirstSignalObservationState =
  | 'waiting'
  | 'signal-detected'
  | 'silent'
  | 'closed'
  | 'errored'
  | 'stopped';

interface FirstSignalObservation {
  schemaVersion: '1.0.0';
  attemptId: string;
  revision: number;                 // monotonic within attemptId
  sessionId: SessionId;
  ownsSession: boolean;
  baselineCursor: number;
  state: FirstSignalObservationState;
  startedAt: string;
  updatedAt: string;
  timeoutMs: number;
  silentSince?: string;             // informational; silent is not terminal
  observedAt?: string;
  observedSequence?: number;
  closedReason?: 'user' | 'transport' | 'session-closed' | 'runtime-shutdown';
  error?: { code: string; message: string };
}
```

ObservationMonitor 注册持续的 main-owned event/state listener，并从 `baselineCursor` replay；listener 必须在 snapshot/replay 前建立以避免水合间隙，且不注册/推进 renderer subscriber cursor。silence 由独立 timer 产生，只把 observation 更新为非终态 `silent`，listener 继续等待 late signal，直到 signal、closed、errored 或 stop；stop/销毁必须清 timer 和 listener。不得用一次会在 timeout 后移除 listener 的 `SessionManager.waitFor` 覆盖整个生命周期；若实现复用 `waitFor`，timeout 后必须从 `lastCursor` 立即 re-arm。

Renderer 不能只比较“最后处理过的事件”。transcript adapter 必须维护 `lastVisibleDeviceSequence`：只有非空 device 文本对应的 xterm `write` completion callback（或等价 awaitable renderer ack）成功返回，且 Terminal 未 dispose/unmount，才推进该 sequence；仅调用同步 `term.write` 不算 visible。state/error/clear/outgoing、被过滤数据和暂时解码为空的不完整 UTF-8 chunk 都不推进。`renderEventToXterm` 应返回 Promise/接受 completion callback，并产生 `{ wroteDeviceText, visibleDeviceSequence? }` 等价 ack；只有 `observedSequence <= lastVisibleDeviceSequence` 才推导 `signal-visible` 并完成 journey。delayed callback、dispose/unmount 和 snapshot replay 必须保证不提前完成且每段数据恰好渲染一次。

First-signal IPC DTO：

```ts
interface StartFirstSignalObservationRequest {
  sessionId: SessionId;
  ownsSession: boolean;
  baselineCursor?: number;
  timeoutMs: number;
  clientAttemptKey: string;
}
interface GetFirstSignalObservationRequest { attemptId: string }
interface StopFirstSignalObservationRequest { attemptId: string; reason: 'user' | 'retry' | 'session-dispose' }
```

Main mint `attemptId`；同 `clientAttemptKey + sessionId` 的 start 幂等返回既有 observation，同 key 不同 session 返回冲突错误。Renderer 先注册 `onEvent` 再调用 status，并忽略较小 revision。stop 幂等。active observation 保留到 signal/session terminal/显式 stop；终态保留 10 分钟供 Renderer reload 水合后清理。Renderer crash/reload 不停止 monitor，session dispose/runtime shutdown 必须清理。

`FirstSuccessViewState` 是 renderer-local 派生态而非版本化 IPC DTO：

```ts
type FirstSuccessViewState = {
  phase:
    | 'checking' | 'needs-workspace' | 'needs-device' | 'needs-attention'
    | 'ready-to-connect' | 'connecting' | 'waiting-for-output'
    | 'data-received' | 'display-unavailable' | 'silent' | 'errored'
    | 'disconnected' | 'cancelled' | 'completed';
  attemptId?: string;
  sessionId?: SessionId;
  signalDetected: boolean;
  signalVisible: boolean;
  disconnectReason?: 'user' | 'transport' | 'session-closed';
  primaryAction?: string;
  recoveryActions: ReadonlyArray<string>;
};
```

### 4.4 OperationEvent

```ts
type OperationRisk =
  | 'read-only'
  | 'state-affecting'
  | 'disruptive'
  | 'destructive-or-unknown';
type ApprovalPolicy = 'none' | 'notify' | 'human-once';
type OperationPhase =
  | 'requested'
  | 'awaiting-approval'
  | 'blocked'
  | 'queued'
  | 'running'
  | 'cancel-requested'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'denied'
  | 'expired'
  | 'superseded'
  | 'cancelled'
  | 'interrupted';

type CallAttemptPhase =
  | 'received'
  | 'started'
  | 'approval-required'
  | 'succeeded'
  | 'failed'
  | 'rejected';

type CancellationCapability = 'none' | 'best-effort' | 'safe-point';
type CallerPrincipalId = string;

interface OperationActor {
  kind: 'human' | 'agent' | 'system' | 'device';
  actorId: string; // server assigned grouping/correlation only; never authorization subject
  displayName?: string;
  channel: 'renderer' | 'local-mcp-agent' | 'internal';
  transportHint?: 'http' | 'stdio-proxy'; // advisory only; never authorization input
}

interface OperationTargetRef {
  kind: 'session' | 'workspace' | 'serial-port' | 'probe' | 'firmware' | 'ui' | 'runtime';
  id: string;       // opaque/sanitized
  label: string;    // display-safe
}

interface OperationEvent {
  schemaVersion: '1.0.0';
  runtimeId: string;
  sequence: number;                 // monotonic within runtimeId
  eventId: string;
  operationId: string;              // logical goal; stable across approval retries
  callId?: string;                  // unique server id for one MCP/direct IPC invocation
  parentOperationId?: string;
  clientCorrelationId?: string;     // external association only
  timestamp: string;
  type: string;
  actor: OperationActor;
  surface: 'terminal' | 'workspace' | 'control-profile' | 'workflow' | 'debug' | 'ui' | 'runtime';
  action: string;
  risk: OperationRisk;
  approvalPolicy: ApprovalPolicy;
  phase: OperationPhase;            // logical operation state
  callPhase?: CallAttemptPhase;      // per-call state; terminal per CallAttempt
  blockReason?: 'ai-paused' | 'approval-mode' | 'dependency';
  cancellationCapability?: CancellationCapability;
  targets: ReadonlyArray<OperationTargetRef>;
  argumentSummary?: Record<string, unknown>; // allowlisted + redacted
  argumentDigest?: string;          // diagnostic/correlation only; not an authorization token
  approvalId?: string;
  clientAcknowledged?: boolean;      // e.g. legacy confirm=true
  authorizationSource?: 'none' | 'human-grant' | 'automation-policy';
  authorizationRuleDisplayId?: string; // Main-generated safe projection; automation only
  progress?: { current?: number; total?: number; unit?: string; messageCode?: string };
  evidenceRefs?: ReadonlyArray<EvidenceRef>;
  error?: { code: string; messageCode?: string; details?: unknown };
}
```

operation reducer 与 CallAttempt reducer 分离。operation 只接受单调状态迁移，终态不可被后续普通事件覆盖；每个进入 handler 的调用都有独立 `callId` 和唯一 terminal `callPhase`。`rejected` 表示执行前的契约/policy/precondition 拒绝，不能借用表示人类决定的 `denied`。后续重复调用失败也不得覆盖已完成 operation 的终态。

异常退出恢复按最后 phase 分类：只有曾进入 `queued | running | cancel-requested` 的无终态 operation 标为 `interrupted`；`requested` 标为 `rejected(runtime-ended-before-admission)`，`awaiting-approval | blocked` 因 runtime-bound grant/lease 失效而标为 `expired(runtime-restart)`。不得把从未 admission 的请求描述成“执行中断”。

### 4.5 Activity cursor

```ts
interface ActivityCursor {
  runtimeId: string;
  sequence: number;
}

interface ActivitySnapshot {
  events: ReadonlyArray<OperationEvent>;
  cursor: ActivityCursor;
  truncated: boolean;
  oldestAvailable?: ActivityCursor;
  droppedEventCount: number;
}
```

Renderer 必须先注册 event listener，再请求 snapshot，或由 IPC adapter 提供原子 subscribe 契约，避免水合间隙。

### 4.6 PreparedOperation / ApprovalRequest / ApprovalGrant

```ts
type ApprovalMode =
  | 'interactive-required'
  | 'headless-deny'
  | 'automation-allowlisted';

type ContinuationKind = 'mcp-retry' | 'control-profile-ipc' | 'automation-initial';
type ConsumerSurface = 'mcp' | 'control-profile-run-download' | 'control-profile-start-download';

interface PreparedContinuation {
  kind: ContinuationKind;
  surface: ConsumerSurface;
  executionMode: 'sync' | 'background';
}

interface PreparedOperation {
  schemaVersion: '1.0.0';
  preparedOperationId: string;
  operationId: string;
  approvalMode: ApprovalMode;
  authorizedPrincipalId: CallerPrincipalId;
  continuation: PreparedContinuation;
  action: string;
  canonicalArgumentDigest: string;
  effectFingerprint: string;
  targets: ReadonlyArray<OperationTargetRef>;
  targetBindingDigest: string;      // exact internal probe/device/target binding
  expandedDefaultsDigest: string;
  artifacts: ReadonlyArray<{
    kind: 'firmware' | 'script' | 'config';
    displayName: string;
    resolvedPathDigest?: string;
    contentSha256: string;
    size: number;
  }>;
  controlProfileRevision?: string;
  planManifest?: {
    manifestDigest: string;
    steps: ReadonlyArray<{
      id: string;
      action: string;
      risk: OperationRisk;
      effectFingerprint: string;
      effectSummaryCode: string;
      parameterSummary: Record<string, unknown>; // allowlisted + display-safe
      targetRefs: ReadonlyArray<OperationTargetRef>;
    }>;
  };
  preparedAt: string;
  expiresAt: string;
}

interface ApprovalRequest {          // Main/Broker internal request
  schemaVersion: '1.0.0';
  approvalId: string;
  operationId: string;
  requestedByCallId: string;
  preparedOperationId: string;
  approvalMode: ApprovalMode;
  authorizedPrincipalId: CallerPrincipalId;
  continuation: PreparedContinuation;
  action: string;
  risk: OperationRisk;               // risk and approval policy remain independent
  scope: 'single-action' | 'operation-plan';
  actor: OperationActor;
  targets: ReadonlyArray<OperationTargetRef>;
  argumentSummary: Record<string, unknown>;
  effectFingerprint: string;
  planManifest?: {
    manifestDigest: string;
    artifacts: ReadonlyArray<{ displayName: string; contentSha256: string; size: number }>;
    steps: ReadonlyArray<{
      id: string;
      action: string;
      risk: OperationRisk;
      effectFingerprint: string;
      effectSummaryCode: string;
      parameterSummary: Record<string, unknown>;
      targetRefs: ReadonlyArray<OperationTargetRef>;
    }>;
  };
  impactSummaryCode: string;
  requestedAt: string;
  expiresAt: string;
  state: 'pending' | 'approved' | 'denied' | 'expired' | 'superseded' | 'consumed';
}

interface ApprovalGrant {
  approvalId: string;
  operationId: string;
  preparedOperationId: string;
  effectFingerprint: string;
  manifestDigest?: string;
  runtimeId: string;
  approvalMode: ApprovalMode;
  authorizedPrincipalId: CallerPrincipalId;
  continuation: PreparedContinuation;
  approvedBy: 'renderer-human';
  expiresAt: string;
  nonceHash: string;
}

interface AuthorizationRecord {       // Broker internal authority; never client supplied
  schemaVersion: '1.0.0';
  recordId: string;
  sequence: number;
  approvalId?: string;
  operationId: string;
  preparedOperationId?: string;
  transition: 'grant-issued' | 'grant-denied' | 'grant-expired' | 'grant-superseded' | 'grant-consumed' | 'automation-hit';
  effectFingerprint: string;
  runtimeId: string;
  approvalMode: ApprovalMode;
  authorizedPrincipalId: CallerPrincipalId;
  continuation: PreparedContinuation;
  ruleId?: string;
  consumedByPrincipalId?: CallerPrincipalId;
  consumedByCallId?: string;
  consumedBySurface?: ConsumerSurface;
  timestamp: string;
}

interface ApprovalDecisionRecord {    // redacted user-visible projection
  schemaVersion: '1.0.0';
  approvalId: string;
  operationId: string;
  action: string;
  targets: ReadonlyArray<OperationTargetRef>;
  decision: 'approved' | 'denied' | 'expired' | 'superseded';
  reason?: 'human' | 'timeout' | 'not-reviewed' | 'mismatch' | 'new-intent';
  decisionDoesNotExecuteBackend: true;
  decidedAt: string;
}

interface OperationReceipt {          // execution evidence, not a recovery point
  schemaVersion: '1.0.0';
  operationId: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  evidenceRefs: ReadonlyArray<EvidenceRef>;
  recordedAt: string;
}

interface ApprovalBrokerLimits {
  schemaVersion: '1.0.0';
  maxPendingPerRuntime: 16;
  maxPendingPerPrincipal: 8;
  maxArtifactBytes: number;            // recommended default 64 MiB
  maxPreparedBytesPerRuntime: number;  // recommended default 256 MiB
  maxPreparePerMinutePerPrincipal: 20;
  maxPreparePerMinuteGlobal: 100;
}

interface CompensationCandidate {
  schemaVersion: '1.0.0';
  candidateId: string;
  sourceOperationId: string;            // last known successful verified deployment
  targetBindingDigest: string;
  artifact: {
    mainOwnedSourceRef: string;          // never exposed raw to Renderer/export
    displayName: string;
    contentSha256: string;
    size: number;
  };
  knownGoodAt: string;
  expiresAt: string;
}
```

本节中的 `PreparedOperation`、`ApprovalRequest`、`ApprovalGrant`、`AuthorizationRecord`、`ApprovalBrokerLimits`、`CallerPrincipalId`、`PreparedContinuation`、`CompensationCandidate` 和 `ExecutionAdmissionLease` 都是 Main/Broker internal schema，不得整体进入 preload、Renderer、Activity 或导出。跨边界只允许显式 display-safe 投影，例如：

```ts
interface AuthorizationDisplay {
  source: 'none' | 'human-grant' | 'automation-policy';
  ruleDisplayId?: string; // opaque + sanitized; never raw rule/config path
}

interface ApprovalCapabilitiesView {
  schemaVersion: '1.0.0';
  mode: ApprovalMode;
  humanApprovalAvailable: boolean;
  automationEnabled: boolean;
  continuationKinds: ReadonlyArray<ContinuationKind>;
}

interface ApprovalRequestView {
  schemaVersion: '1.0.0';
  approvalId: string;
  operationId: string;
  action: string;
  risk: OperationRisk;
  scope: 'single-action' | 'operation-plan';
  actor: OperationActor;
  targets: ReadonlyArray<OperationTargetRef>;
  argumentSummary: Record<string, unknown>;
  plan?: {
    artifacts: ReadonlyArray<{ displayName: string; contentSha256: string; size: number }>;
    steps: ReadonlyArray<{
      id: string;
      action: string;
      risk: OperationRisk;
      effectSummaryCode: string;
      parameterSummary: Record<string, unknown>;
      targetRefs: ReadonlyArray<OperationTargetRef>;
    }>;
  };
  impactSummaryCode: string;
  requestedAt: string;
  expiresAt: string;
  state: ApprovalRequest['state'];
  authorization: AuthorizationDisplay;
}

interface CompensationCandidateSummary {
  schemaVersion: '1.0.0';
  candidateId: string;
  sourceOperationId: string;
  target: OperationTargetRef;
  artifact: { displayName: string; contentSha256: string; size: number };
  knownGoodAt: string;
  expiresAt: string;
}
```

映射器使用 allowlist 构造 DTO；禁止把 `authorizedPrincipalId`、`preparedOperationId`、nonce、内部 effect/target binding digest、`mainOwnedSourceRef`、prepared bytes/handles、raw automation `ruleId` 或完整路径带到 Renderer。`authorizationRuleDisplayId`/`ruleDisplayId` 只由 Main 从内部 rule 生成非敏感稳定标签。`automation-initial` 表示 allowlisted automation 的首次 MCP execution consumer binding，不得伪装为 human approval retry。

`prepareHighImpactOperation()` 不得调用任何有副作用的 backend 方法；允许 RiskPolicy 明确 allowlist 的只读 detect/status/availability/catalog 查询，并应通过 capability-specific read-only facade 暴露。connect/halt/run/reset/write/erase/flash/start-server 等方法在 prepare 中调用数必须为 0。`effectFingerprint` 至少覆盖 tool/action、canonical args、展开后的关键默认值、host realpath、firmware/script/config 内容 SHA-256 + size、control-profile revision、稳定且脱敏的目标 probe/device identity、continuation kind/surface/execution mode，以及精确 steps。路径字符串或 `argsDigest` 单独不足以授权。

PreparedOperation 的敏感解析结果和必要 artifact bytes/安全句柄只留在 Main 内存，不进入 Activity 或导出。hash 应流式、可取消，并在 commit 前检查大小/配额；执行要么消费同一份 prepared bytes/config，要么在 backend 前最后边界原子复验 fingerprint，禁止批准后按原始路径静默重读。Grant 不作为可长期保存 secret。runtime 重启、过期或二次使用均失败；对已匹配正确 principal/kind/surface/mode 的 consumer，任一 effect/new-intent 变化会 supersede。错误 consumer 只 reject 并保留 grant。相同 `runtimeId + approvalMode + authorizedPrincipalId + continuation.kind/surface/executionMode + effectFingerprint` 的 pending request 必须去重并返回同一 approvalId。

默认 quotas 见 `ApprovalBrokerLimits`，可在基准后收紧/放宽但必须版本化。超限稳定返回 `APPROVAL_QUEUE_FULL` 或 `PREPARE_TOO_LARGE`，effectful backend=0，只记录脱敏 diagnostic。新请求不得为了腾出空间而淘汰已批准未消费项。deny/expire/supersede 立即释放；consume 后仅保留 execution backend 仍需的 snapshot，operation 终态即释放；显式 stop/runtime shutdown 也必须清理 bytes/handles。Renderer reload 保留到 TTL，永久窗口关闭可把 interactive pending 转为 expired 并释放。不同 fingerprint 洪泛与中途 stop request 必须受 per-principal + global rate limit/AbortSignal 控制；socket、HTTP transport、stdio proxy 或 reconnect identity 只能作附加诊断/限流信号，不能作为唯一安全 key。

`CompensationCandidate` 只在同一 target binding 的部署完成且 verify 成功后由 Main 建立/更新，表示“上一次 LinkTerm 已知成功部署”，不能从失败的 OperationReceipt 或当前 artifact 猜测。它只保留 Main-owned source ref + hash/size，不保留 prepared bytes；显示和点击时都重新解析 source、比较 hash 与 target binding。缺失/变化/过期就不显示 reflash action。点击只生成新的 PreparedOperation/plan approval。

### 4.7 AI control state

```ts
interface AiControlState {
  schemaVersion: '1.0.0';
  global: { paused: boolean; epoch: number; changedAt: string; changedBy: 'human' | 'system' };
  sessions: Record<SessionId, { paused: boolean; epoch: number; changedAt: string }>;
}

interface ExecutionAdmissionLease {
  schemaVersion: '1.0.0';
  leaseId: string;
  runtimeId: string;
  operationId: string;
  principalId: CallerPrincipalId;     // Main-assigned admission subject; never actorId
  scope: { kind: 'global' } | { kind: 'session'; sessionId: SessionId };
  globalEpoch: number;
  sessionEpoch?: number;
  planManifestDigest?: string;
  acquiredAt: string;
}
```

epoch/fence 用于处理 Pause 与并发请求竞态。`effectivePaused(scope) = global.paused || (scope=session && sessions[sessionId].paused)`；Global Resume 只清 global latch，Session Resume 只清对应 session latch，任何局部 Resume 都不能越过另一层 Pause。Pause/Resume 每次状态变化都递增对应 epoch。Session-scoped lease acquisition 必须在同一 admission transaction 中校验 global + session 两个 latch/epoch；global operation 至少校验 global latch/epoch。

Pause 在 epoch 更新处线性化：尚未取得 execution lease 的 state-affecting 请求不得 admission；已经取得 lease 并 running 的 operation 可以继续其已批准步骤，用户需要单独 stop control。Lease 不可转移，仅覆盖绑定 operation/principal/scope/相关 epochs/plan，operation 终态时释放，runtime restart 时全部失效；double release 幂等。验收断言是“Pause commit 后没有新 AI change 被 admitted”，不是“没有任何后续 backend step 开始”。

## 5. 状态机

### 5.1 First Success

```text
checking
  ├─ needs-workspace
  ├─ needs-device
  ├─ needs-attention
  └─ ready-to-connect
          └─ connecting
                ├─ ready-to-connect (editing after open failed or plan stale)
                ├─ cancelled
                └─ waiting-for-output
                        ├─ data-received
                        │      ├─ completed (signal visible)
                        │      └─ display-unavailable
                        │             ├─ repair + replay + xterm ack ── completed
                        │             ├─ disconnect-and-edit (owned only) ── ready-to-connect
                        │             ├─ disconnect ── disconnected(user)
                        │             └─ back-to-session (reused only; preserved)
                        ├─ silent ── late signal ── data-received
                        │      ├─ disconnect-and-edit (owned only) ── ready-to-connect
                        │      ├─ disconnect ── disconnected(user)
                        │      └─ back-to-session (reused session only; session preserved)
                        ├─ errored ── ready-to-connect/retry
                        ├─ disconnected(transport|session-closed) ── ready-to-connect/reconnect
                        └─ cancelled
```

Renderer coordinator 由 readiness + selected intent + session state + ObservationMonitor + transcript rendering evidence 推导状态。所有事件绑定 `attemptId + sessionId`；旧 attempt 的迟到 data/state 不得完成新 attempt。不得持久化整个状态机；只持久化选择、recent workspace、dismissed hints 和明确 pause policy。

Guided flow 自己创建且 open 失败的 session，在提取 operation/error evidence 后默认销毁，避免 orphan errored tab 或端口占用。对 open 后的恢复动作固定以下规则：

- Keep waiting 保持 ObservationMonitor/timer/listener，不创建新 attempt。
- Disconnect and edit 只对 `ownsSession=true` 暴露：停止并清理 observation，幂等关闭/销毁 attempt-owned session、释放端口并保留 ConnectionDraft。`ownsSession=false` 时该动作不可用，不能把“编辑”隐式变成关闭已有 session。
- Back to session 仅用于 `ownsSession=false`：停止本次 observation 并离开向导，但保留既有 session。
- Disconnect 是显式关闭动作；无论 ownership 都先停止 observation，再通过 SessionManager 幂等关闭 session，并派生 `disconnectReason='user'`。物理/transport 关闭使用 `transport`，非本动作的 session close 使用 `session-closed`；UI 不得把三者合并成物理断连。Cancel 在 open 前只清当前 attempt/draft flow；open 后不得使用含糊 Cancel 代替上述动作。
- display-unavailable 修复后必须从既有 transcript cursor replay，经 xterm 异步 completion ack 后进入 completed；不得重复渲染或创建第二个 operation。

所有 timer/listener/attempt-owned session 清理都有 dispose/retry/reload/disconnect tests。旧 attempt 的迟到 callback/data/state 不得完成新 attempt。

### 5.2 Operation

```text
requested
  ├─ rejected (version/schema/caller acknowledgement/policy precondition)
  ├─ awaiting-approval
  │          ├─ denied
  │          ├─ expired
  │          ├─ approved + AI paused ── blocked ── resume + revalidate ── queued/running
  │          └─ approved + admitted ── queued/running
  └─ queued/running
              ├─ succeeded
              ├─ failed
              ├─ cancel-requested ── cancelled|failed|succeeded
              └─ interrupted (restart recovery)

blocked
  ├─ expired (TTL/runtime restart)
  └─ superseded (new semantic intent replaces this operation)

CallAttempt (每次 MCP / approval-aware direct IPC invocation 独立)
received
  ├─ approval-required (terminal for this call; operation remains awaiting)
  ├─ rejected (terminal)
  └─ started ── succeeded|failed (exactly one terminal)
```

首次 approval-required call 创建 logical operation，但不得把 operation 写成 running/started；caller 携 `approvalId` continuation 时，Broker 从服务端 request 找回原 `operationId`，同时生成新 `callId`。client 自报 operationId 不被信任。`cancel-requested` 不等于 cancelled。cancellation 文案严格来自 declared capability：safe-point 不降级成 best-effort，none 不暗示可停止；任何档位都不能承诺 rollback。

本规格中的 `backend=0` 统一指 **effectful/execution backend calls 为 0**；无副作用 prepare 阶段只允许 RiskPolicy allowlist 的 detect/status/availability/catalog facade，且其调用次数单独断言。不得把允许的只读 prepare 调用误报为 operation 已执行。

执行前映射必须固定，并按“解析 approval → 校验 Main-assigned principal + continuation kind/surface/mode → 校验 effect/new intent → Pause/lease → consume/execute”的顺序判断：

| 条件 | CallAttempt terminal | Logical Operation / request-grant | effectful backend |
| --- | --- | --- | --- |
| 缺少 caller acknowledgement / version mismatch / handler 内 schema or policy reject | `rejected` | `rejected` | 0 |
| human grant pending | `approval-required` | `awaiting-approval` | 0 |
| human deny | `rejected` | `denied` | 0 |
| approval TTL 到期 | `rejected` | request/grant/operation 原子 `expired`；释放 prepared resources | 0 |
| 已匹配正确 principal + continuation 的 consumer 上，effect 改变或出现新 semantic intent | `rejected` | 旧 request/grant/operation 原子 `superseded` 并释放；新 operation/request 重新审批 | 0 |
| consumed replay / duplicate continuation | `rejected`（返回原 operation/job ref 或 `ALREADY_CONSUMED`） | request/grant 保持 `consumed`；原 operation 保持当前/终态，不改写 | 0（不重复） |
| wrong principal / continuation kind / surface / execution mode | `rejected` | 原 request/grant 与 operation 保持原状态到 TTL；错误 consumer 不得作废 | 0 |
| AI paused before admission | `rejected`（稳定 blocked error） | `blocked`，直到 resume/TTL/supersede | 0 |
| grant valid + lease acquired | 后续 `succeeded|failed` | `queued/running` 后进入执行终态 | 按计划 |

`confirm=false → confirm=true` 是两个 CallAttempt；前者 operation 必须 `rejected`，后者创建新 operation。相同 `approvalId` retry 复用原 operation。新 semantic intent 替换旧 blocked operation 时，旧 operation 必须进入 `superseded`，不能永久悬挂。

## 6. 核心服务

### 6.1 RuntimeReadinessService

职责：并行收集 runtime metadata、serial discovery、workspace/profile、J-Link availability/probes、session 和 Agent integration 状态，输出稳定 snapshot。

设计：

- 从 `get_app_status` 现有 builder 提取共享纯逻辑，而不是让 UI 调用 MCP。
- 每个 provider 独立超时和错误分类；一个 provider 失败不抹掉其他结果。
- 支持 `AbortSignal`；Renderer unmount/refresh 时取消过期扫描。
- 不执行连接、reset、flash、配置写入或自动安装。
- 结果中的 probe/port/workspace 信息经过 display-safe mapper。

### 6.2 DeviceCandidateResolver

职责：组合 live discovery、saved connection、control profile、device catalog，生成候选及证据。

规则：

- 仅在 stable identity 精确匹配时使用 `exact`。
- 单一候选不等于 exact。
- 多候选不得自动 submit 第一个。
- 不能从 COM 口名直接推断 MCU target。
- profile 与 live evidence 冲突时必须 `requiresUserConfirmation=true`。

### 6.3 FirstSuccessCoordinator

建议实现为纯 reducer + hooks adapter：

- 输入 readiness snapshot、用户 intent/selection、session lifecycle 和 main-owned ObservationMonitor milestone。
- 输出当前 step、status、primary action、recovery actions 和 success milestones。
- 使用 main/core 的共享 ObservationMonitor 持续 listen + history replay 检测首个非空 device data；单次 `waitFor` timeout 不能结束 late-signal 观察，Renderer 也不能单独以 mount 后收到的事件判断成功。
- 保留 `useTranscript` listen-before-snapshot 语义。
- subscribe 失败单独进入 UI-channel error，不得当 silent device。

ObservationMonitor 建立 baseline cursor 和 predicate，并把 `waiting | signal-detected | silent | closed | errored | stopped` 作为结构化 milestone 通过 IPC 返回/推送。这样 signal 即使早于 `session:create` 返回或 TerminalView mount 也不会丢失，同时 Renderer transcript 仍负责实际输出展示。

具体契约：新 session 的 baseline 通常为 0；重用 session 必须在本次 attempt 开始前从 main 获取 latest cursor。monitor 可以在 `session:create` 返回之后启动，因为 replay 能读回提前到达的数据，但不得使用 `session.subscribe`。Renderer transcript hook 需要暴露 `hydrationState` 与 `lastVisibleDeviceSequence`；subscribe 失败时即使 monitor 已检测信号，也显示“检测到设备信号，但终端显示通道不可用”，修复订阅并 replay 后只完成一次。不完整 UTF-8 device chunk 后即使收到更高 sequence 的 state event 也不得完成，直到对应 device 文本的 xterm write completion callback/等价异步 ack 成功；Terminal dispose/unmount 或旧 attempt 的迟到 callback 不推进 visible。

### 6.4 OperationLedger

职责：append、snapshot/readSince、subscribe、容量和 drop 诊断。

第一阶段要求：

- 内存 ring buffer，建议 1000 operations / 5000 events，最终由基准调整。
- append 不等待 Renderer；listener 异常隔离。
- event schema 验证失败产生本地 diagnostic，不写入不合法事件。
- 普通 ledger 是 best-effort 观测投影；append failure 默认不改变原业务结果，但 `droppedEventCount`/health diagnostic 可见，并在 release metric 中视为不达标。
- 审批授权不依赖这个 best-effort ledger；ApprovalBroker 内的 mandatory `AuthorizationRecord` 才参与 fail-closed 决策。

### 6.5 OperationRecorder

职责：把 MCP、IPC、workflow、session control 转换为统一事件。

建议 seam：

- MCP：在 `registerTool` wrapper 为每次 invocation 生成 `callId`；普通调用同时生成 `operationId`，approval retry 则由 Broker 找回原逻辑 operation。记录 operation state 与 CallAttempt lifecycle，不把二者混为一条 started/terminal 状态机。
- Workflow：订阅 JobManager update，把 steps/progress 作为 child events。
- Human IPC：在 main handler adapter 记录可信 actor，不接受 renderer 自报 actor。
- Session write：MCP tool / IPC handler 记录 action summary；transcript 保持原始顺序真源。
- Profile mutation、UI configure、runtime restart：记录目标与结果，不写敏感完整 payload。

GitNexus 对 `registerTool` 的 upstream impact 为 HIGH。实施前必须再次运行 impact，先添加 characterization tests；不要在同一提交迁移 approval 和 instrumentation。

### 6.6 RiskPolicy

集中 map `surface + action → risk + approval policy + redaction policy`。

初始策略：

- Read-only：list/get/read/search/status/screenshot/probe_detect，approval=`none`。
- State-affecting：open/close session、UI configure、profile save、terminal write、breakpoint mutation，approval=`notify` 或按现有产品契约；必须可见/可 pause。
- Disruptive：reset/reboot/halt/run、GDB server 等中断当前状态的动作，approval=`human-once`。
- Destructive-or-unknown：erase/flash、memory write、Commander script 和未分类新写操作，approval=`human-once`。

所有未分类的新 state-affecting tool 在开发/测试中失败，避免静默落到 read-only。`write_to_session` 不被称为 reversible，也不尝试用通用文本分类器保证命令安全；它依靠可见性、session trust/pause 和后续专门策略。

### 6.7 ApprovalBroker

职责：prepare、request、list pending、human resolve、verify/consume grant、expire。

安全要求：

- broker 在 main/core 注入层，不在 renderer。
- MCP 不能创建“approved”状态，不能调用 resolve IPC。
- `ui_configure` 不能触发 ApprovalSheet 的按钮行为。
- `prepareHighImpactOperation()` 在无副作用阶段解析 canonical args、realpath、artifact bytes/hash/size、profile revision、target/probe binding、展开默认值和 plan steps，并生成 `effectFingerprint`；只允许 RiskPolicy allowlist 的 read-only backend facade，副作用方法调用为 0；排除 correlationId、confirm、approvalId 等非语义字段。
- request 默认 120 秒过期；grant 一次性。
- 以 `runtimeId + approvalMode + authorizedPrincipalId + continuation.kind/surface/executionMode + effectFingerprint` 为 key 去重；Approval UI 一次只呈现一个，其余排队；重复 retry 不重复发送 assertive/OS notification。
- queue 中请求若在展示前过期，原子转为 `expired`，移出队列并投影 `ApprovalDecisionRecord{reason:'not-reviewed', decisionDoesNotExecuteBackend:true}`；不得弹迟到 sheet/notification。
- 强制 `ApprovalBrokerLimits`：prepare 前检查单 artifact/总 bytes、pending 数、per-principal 与 global rate；超限 fail closed，且不得淘汰 approved-unconsumed grant。
- 多步骤 workflow 使用 immutable plan manifest；单次 grant 只覆盖 manifest 中的精确 target、artifact 内容、profile/defaults 和 steps。
- `resolve` 与 `verifyAndConsume` 在 Broker 单一 mutex/serialized transaction 内完成。每次 transition 先构造并验证 next state + `AuthorizationRecord`、预留不可丢的 active-record capacity，再一次性 publish；schema/serialization/capacity/append 任一失败都不得部分改变 grant/request。
- consumer 验证顺序固定：先解析服务端 approval/request，再校验 Main-assigned principal、continuation kind、surface 和 execution mode；错误 consumer 只产生 rejected CallAttempt，保留原 grant 到 TTL。只有这些 binding 全部匹配后，当前 args/effect/new intent 的变化才把旧 request/grant/operation supersede 并释放。不得把 wrong-surface 攻击误当成合法新 intent。
- Verify、Pause admission 与 Consume 形成 backend 前最后一个可控边界。消费后 backend 抛错也不得“退回” grant；operation 记录 failed。crash 发生在 backend side effect 与结果记录之间时只能标记 interrupted/unknown，不承诺 exactly-once。
- `ApprovalDecisionRecord` 是批准/拒绝/过期的用户可见决策投影，`OperationReceipt` 是执行尝试/结果证据，`AuthorizationRecord` 是 Broker 内部授权 authority；三者不得共用模糊 `receipt` 名称。OperationLedger 是可丢的观测投影，AuditStore 是默认开启、可由用户关闭的异步持久副本；两者失败生成 health diagnostic，但不能反向伪造或撤销 Broker 状态。该模型只承诺 authorization at-most-once。
- 执行消费同一 PreparedOperation 的 bytes/config，或在 backend 前原子复验 effect fingerprint；任何 path content、symlink、profile、probe/target、默认参数或 plan 变化均 mismatch。
- grant 必须同时匹配当前 Main-assigned principal、continuation kind/surface/execution mode。wrong principal/kind/surface/mode 的 CallAttempt rejected、effectful backend=0，原 grant 保留到 TTL，避免攻击者借错误消费使合法请求失效；成功消费记录 consumedByPrincipalId/callId/surface。
- 拒绝/过期/不匹配时 effectful/execution backend call count 为 0；prepare read-only facade 按 allowlist 单独计数。
- 现有 direct Renderer IPC `CONTROL_PROFILE_RUN_DOWNLOAD` / `CONTROL_PROFILE_START_DOWNLOAD`（`registerControlProfileIpc`）必须走同一 prepare → plan sheet → Broker grant → execute/start-job 协议。Download 按钮点击和当前硬编码 `confirm:true` 只表示发起 prepare，绝不能自动产生 grant；MCP 与 IPC 也不能重复消费同一 grant。

### 6.8 ApprovalModePolicy

职责：由 Main composition root 在启动时冻结审批模式，并向 readiness/app status 暴露只读 capability。

- desktop 默认 `interactive-required`；窗口最小化、关闭、无活动窗口、Renderer crash/reload、MCP reconnect 均不得降级。
- 真正 headless 默认 `headless-deny`。`automation-allowlisted` 只能由独立显式配置/启动入口启用，把配置来源和命中 allowlist 写入 `AuthorizationRecord`。
- request args、HTTP headers、client schema、transport hint 和 Renderer 均不能切换模式。
- 当前 stdio 是 HTTP proxy，第一版 UI 统一显示 `local-mcp-agent`；transport 只作诊断提示，不能作为授权身份。

### 6.9 AiControlPolicy

职责：暂停/恢复 AI changes，即 state-affecting/disruptive/destructive-or-unknown operations 和 session writes。

- read-only 继续允许；UI 明确显示“AI changes paused; read-only checks may continue”。
- `origin='human'|'system'` 不受 AI pause 影响。
- session-specific pause 在 `SessionManager.write` 或其前置 policy seam 检查。
- admission 检查和 epoch 更新在线性化 seam 上完成；awaiting-approval、approved、queued 但尚未取得 execution lease 的任务保持 blocked。
- main-owned OperationAdmissionCoordinator 以固定锁序把 current epoch 验证、lease acquisition、effect revalidation 与 grant consume 组成一个 admission transaction；与 Pause 同时发生时只能有一个先线性化，不能出现 consumed grant 无 lease 或新 lease 越过 pause。
- 已经取得 execution lease/running 的 operation 不因 Pause 自动假装 cancelled，且其已批准计划步骤可能继续；用户另选 capability 对应的 stop control。
- pause 状态持久化，重启后不自动恢复。
- pending approval 在 pause 后即使被批准也不能 admission；必须等显式 Resume 后重新通过 fence、effect fingerprint、目标与 expiry 检查，并在 UI 显示 approved-but-paused。
- effective pause 使用 global OR session：global pause 覆盖所有 session，session resume 不能越过它；global resume 不清除仍被单独暂停的 session，session pause 也不因 global resume 丢失。session-scoped admission lease 同时绑定/复验 globalEpoch 与 sessionEpoch，Take Over 只设置该 session latch。

### 6.10 AuditRedactor / AuditStore

Redactor 在写 ledger/store 前运行：

- allowlist 字段优先，denylist 仅作补充。
- password/privateKey/passphrase/token/auth/env secret 永不进入 event。
- binary/base64、screenshot、firmware、memory payload 记录 size/hash/type，不记录正文。
- Commander script 记录 hash、行数、风险摘要；默认无全文。
- workspace path 默认可显示本机 basename；导出可选择完整路径或路径别名。

持久化阶段使用 JSONL：

- 目录：Electron `userData/activity/`。
- POSIX 文件权限 0600；Windows 使用用户目录 ACL 默认并记录限制。
- 默认 30 天、单文件 10 MiB 轮转；可配置关闭。
- 写入使用独立串行队列，不阻塞 transport/MCP response。
- 启动时只读取最近有界数据；破损尾行可忽略并记录 warning。
- 提供 Delete all local activity data。

## 7. IPC 与 Preload API

在 `src/shared/ipc-protocol.ts` 增加稳定 channel：

```text
readiness:get
readiness:refresh
readiness:subscribe
readiness:event
firstSignal:start
firstSignal:status
firstSignal:stop
firstSignal:event
activity:subscribe
activity:event
activity:snapshot
activity:export
activity:clear
approval:list
approval:resolve
approval:event
aiControl:get
aiControl:set
```

Preload 暴露最小命名空间：

```ts
window.linkterm.readiness.get/refresh
window.linkterm.readiness.onEvent
window.linkterm.firstSignal.start/status/stop/onEvent
window.linkterm.activity.snapshot/onEvent/export/clear
window.linkterm.approval.capabilities/list/onEvent/resolve
window.linkterm.aiControl.get/set
```

约束：

- renderer 只能 resolve pending approval，不能自建 request/grant。
- `approval:resolve` 校验 webContents 来自当前受信 BrowserWindow。
- approval capabilities 只读返回 Main 启动时冻结的 mode；Renderer/window lifecycle 不得修改 mode。
- snapshot + subscription 使用 cursor，支持 truncated。
- export 由 main 写文件；renderer 不直接访问 audit path。
- 所有 payload 使用 shared schema；错误码加入 `ERROR_CODES` 与 MCP `ToolErrorCode` 双向同步。
- readiness update 带 generation，Renderer 只接受最新 generation；重叠 refresh、热插拔和慢 provider 的旧结果不得覆盖新事实。
- FirstSuccess Renderer 禁止额外调用 `session.subscribe`；ObservationMonitor 与 TerminalView 的 transcript cursor 相互独立。
- firstSignal attemptId 由 Main 生成，clientAttemptKey 幂等；Renderer 必须 listen-before-status 并按 revision latest-wins，stop 幂等，reload 按 retention 恢复。
- approval/list/event 只返回 `ApprovalRequestView`、`ApprovalDecisionRecord`、`OperationReceipt`、`AuthorizationDisplay` 等 display-safe DTO；recovery 只返回 `CompensationCandidateSummary`。PreparedOperation、ApprovalGrant、AuthorizationRecord、CallerPrincipalId、ExecutionAdmissionLease、mainOwnedSourceRef、nonce/digest/bytes/handles 永不进入 preload。

### 7.1 Control Profile direct-download continuation

选择与 MCP 对称的“两次 invocation”协议；`approval:resolve` **只记录人类决定，绝不自动执行 backend**：

1. Renderer 首次调用既有 RUN/START_DOWNLOAD channel，提交现有语义参数；Main 生成 `callId`/operation、prepare 并返回 `HUMAN_APPROVAL_REQUIRED + approvalId`，effectful backend=0。
2. Approval Sheet 调用 `approval:resolve`；批准只把 request/grant 置为 approved。窗口仍存活时 UI 可立即发起 continuation；Renderer reload 后从 `approval:list` 恢复为 `Approved · ready to continue`，必须显式 Continue，不能因 reload 自动执行。
3. Renderer 以同一原始 channel 发送 `{ kind:'continue-approved', approvalId }`，不回传 path/profile/artifact/target。Main 为这次 invocation 生成新 `callId`，从 Broker 找回 PreparedOperation，并验证当前 Main-assigned principal、channel 和 execution mode。
4. `CONTROL_PROFILE_RUN_DOWNLOAD` 固定 continuation=`control-profile-ipc + sync` 并返回同步结果；`CONTROL_PROFILE_START_DOWNLOAD` 固定 continuation=`control-profile-ipc + background` 并返回 job id。channel/mode 是 PreparedOperation 与 grant 的绑定字段，不能在 continuation 时更改。
5. 第一次合法 continuation 原子 acquire lease + consume grant 后执行。相同 approvalId 的 duplicate/reload retry 不重新执行：返回原 operation/job reference 或稳定 `APPROVAL_ALREADY_CONSUMED`。wrong principal/continuation kind/surface/mode 的 effectful backend=0 且不作废原 grant。
6. Renderer/window 在 resolve 后、continuation 前关闭时不执行；grant 按 TTL 过期并释放。continuation 与 close/cancel 并发以 admission transaction 为线性化点。

初次 prepare request 与 continuation request 使用 strict discriminated union，禁止“既带 approvalId 又带新语义参数”。MCP retry 仍可携原语义参数用于 mismatch 检查，但只能由绑定的 local-MCP principal/mcp surface 消费。

## 8. MCP 契约演进

### 8.1 Operation instrumentation

为 `registerTool` 增加可注入 recorder provider，类似 runtime diagnostics provider；避免修改 63 个 handler 签名。

每次通过 MCP SDK schema 校验并进入 `registerTool` handler 的 call：

1. 生成唯一 server `callId`；无 `approvalId` 的普通/首次调用生成新的逻辑 `operationId`，带 `approvalId` 的 retry 只能由 Broker server-side 找回原 operation，并绑定当前 Main-assigned principal/surface，忽略 client 自报 id/identity。
2. 根据 toolName 读取 risk/redaction/approval policy，append CallAttempt `received` 和必要的 operation `requested`。
3. 非 approval-required 路径进入执行前才 append operation `running` + CallAttempt `started`。
4. approval-required 首次调用只做 prepare；无有效 grant 时把 operation 置为 `awaiting-approval`，CallAttempt 以 `approval-required` 终结，绝不写 operation `running/started`。
5. retry 若 pending，新的 CallAttempt 再次以 `approval-required` 终结；若 approved，则在 principal/continuation/effect 复验、Pause admission 和原子 consume 后进入 queued/running；expiry/supersede/consumed replay/wrong subject 按 5.2 独立终态处理，effectful backend=0。
6. 每个 CallAttempt 在所有 return/throw 分支恰有一个 terminal callPhase；逻辑 Operation 只在 succeeded/failed/rejected/denied/expired/superseded/cancelled/interrupted 时终结。
7. response 可在 evidence meta 返回 `operationId` + `callId`，但保持现有顶层 shape 兼容。

SDK 在 handler 之前拒绝的非法 payload 不创建普通 operation；若需要展示这类诊断，应在 transport/HTTP runtime 记录独立的 validation diagnostic，不能伪造一个已经开始执行的 operation。

handler 内执行前拒绝按 5.2 映射：missing `confirm`, version mismatch, stale runtime, unknown policy 都以 CallAttempt/Operation `rejected` 收口。Pause before admission 使用 `blocked` + TTL；重试/新 intent 必须复用、恢复或显式 supersede，禁止遗留永久 requested/blocked operation。

### 8.2 Approval

新增稳定错误码 `HUMAN_APPROVAL_REQUIRED`，details 至少含：

```json
{
  "approvalId": "apr_...",
  "operationId": "op_...",
  "callId": "call_...",
  "expiresAt": "...",
  "action": "flash_erase",
  "impactSummary": "...",
  "approvalMode": "interactive-required",
  "capability": "human-approval-v1"
}
```

现有 approval-required tool schema 增加可选 `approvalId`。兼容策略：

- `confirm !== true`：继续返回现有 `CONFIRMATION_REQUIRED`，表示 client 还未明确请求高影响动作。
- `confirm === true` 只记为 client acknowledgement；`interactive-required` 且无有效 human grant 时返回 `HUMAN_APPROVAL_REQUIRED`。
- 有匹配 approvalId/grant：从 Broker 找回原 operation，复验 PreparedOperation、Pause admission 与 mode，原子消费后执行。
- `headless-deny`：稳定拒绝，effectful backend=0；`automation-allowlisted`：只有命中 Main 启动时冻结的明确规则才执行，以 `automation-initial + mcp + executionMode` 绑定 PreparedOperation/AuthorizationRecord，并标记 `authorizationSource='automation-policy'` 与 Main 生成的 `authorizationRuleDisplayId`；不得展示为 human approved，也不得把 raw rule 配置投影到 Renderer。

MCP Retry 契约必须确定：首次响应返回 approvalId；后续调用携带 approvalId 和原语义参数，server 找回原 operation。pending 继续返回 `HUMAN_APPROVAL_REQUIRED` 并带当前 state，approved-but-paused 返回稳定 blocked 状态，approved 且 principal/kind/surface/mode/effect 复验通过才消费执行。expired、superseded、consumed replay、wrong principal/kind/surface/mode 分别返回稳定错误并遵循 5.2 资源/终态规则。可以增加只读 approval-status 查询，但绝不能增加 MCP approve/resolve 能力。Renderer 批准后 AI 未重试时，operation 保持 approved/blocked 或直至过期，不能伪造 running。

旧 client（缺少 schema version、approval capability 或 retry 支持）在 `interactive-required`/`headless-deny` 下 fail closed，并得到可理解的升级提示；`get_app_status` 和 runbook 暴露 mode、capability 和兼容要求。不得因为 client 旧、窗口消失或 stdio/http 路径而降级授权策略。

prepare/backpressure 另有稳定错误码：`APPROVAL_QUEUE_FULL`、`PREPARE_TOO_LARGE`、`PREPARE_RATE_LIMITED`。details 只给 limit、retryAfter 和脱敏 scope；不得返回 artifact bytes、完整 path 或内部 probe identity，且 effectful backend=0。

Continuation 终态错误码至少区分 `APPROVAL_EXPIRED`、`APPROVAL_SUPERSEDED`、`APPROVAL_ALREADY_CONSUMED`、`APPROVAL_WRONG_PRINCIPAL`、`APPROVAL_WRONG_KIND`、`APPROVAL_WRONG_SURFACE`、`APPROVAL_WRONG_MODE`；不得都折叠为 mismatch。wrong-principal/kind/surface/mode 不使原 grant 失效；只有正确 consumer 的 effect/new-intent mismatch 才 supersede。

第一版不尝试通过解析任意 terminal command 判断其是否危险。`write_to_session` 标记为 state-affecting，必须可见、可 pause、可关联目标，但命令内容分类是独立研究问题；设备级 flash/erase/reset 等使用明确 tool/risk/approval policy，避免给用户虚假安全感。

实施 M5 前必须冻结 ApprovalMode 默认值、automation allowlist 是否首发及 legacy 兼容期，并 bump MCP schema version。

### 8.3 Actor / caller principal identity

`actorId` 用于 Activity 分组，不是授权 subject。授权、dedupe、grant consume 和安全限流只使用 Main-assigned `CallerPrincipalId`：

- 所有使用当前共享 Bearer credential 的 HTTP 与 stdio-proxy 调用映射为稳定 `local-mcp-principal:<runtimeCredentialId>`；不包含 raw token，并跨 request/new socket/reconnect 保持稳定。
- 通过 sender 验证的 desktop Renderer IPC 映射为独立 `local-desktop-principal:<runtimeId>`；Renderer 自报 principal 无效，reload 后由 Main 重新映射到同一 runtime principal。
- per-request transport/connection/IP 只能作为 diagnostic 或附加 throttle，不得用于 grant binding、dedupe 或唯一 rate-limit key。
- 第一版所有共享-token Agent 都是同一个 MCP principal，UI 显示“本机 MCP Agent”。若未来区分 Copilot/Claude/Codex，必须使用每 integration 独立 credential/handshake，另立 schema/migration。

测试必须覆盖 HTTP 新 socket、MCP reconnect、stdio proxy 循环仍命中同一 per-principal limiter；global limiter 同时生效。错误 principal/kind/surface/mode 消费不使 grant 失效，正确 subject/continuation 可成功一次，之后任何 consumer effectful backend=0。

## 9. Renderer 结构

建议新增：

```text
src/renderer/features/first-success/
  FirstSuccessCoordinator.ts
  StartCenter.tsx
  ReadinessChecklist.tsx
  DeviceCandidateList.tsx
  ConnectionPlanReview.tsx
  FirstSignalStatus.tsx
  RecoveryActions.tsx
  useFirstSuccess.ts

src/renderer/features/activity/
  ActivityCenter.tsx
  AiStatusCapsule.tsx
  OperationTimelineItem.tsx
  ApprovalSheet.tsx
  AuditExportDialog.tsx
  useActivity.ts
  useApprovals.ts
  operation-view-reducer.ts
```

Core/shared 建议新增：

```text
src/core/readiness/
  types.ts
  runtime-readiness-service.ts
  device-candidate-resolver.ts

src/core/preferences/
  first-success-preferences.ts

src/core/session/
  first-signal-observation.ts

src/core/activity/
  types.ts
  schemas.ts
  operation-ledger.ts
  operation-recorder.ts
  operation-state-machine.ts
  call-attempt-state-machine.ts
  risk-policy.ts
  prepared-operation.ts
  approval-broker.ts
  approval-mode-policy.ts
  ai-control-policy.ts
  operation-admission-coordinator.ts
  audit-redactor.ts
  audit-store.ts

src/shared/
  activity-ipc-types.ts
  readiness-ipc-types.ts
  first-signal-ipc-types.ts
```

Main adapter：

```text
src/main/ipc/readiness-ipc.ts
src/main/ipc/first-signal-ipc.ts
src/main/ipc/activity-ipc.ts
src/main/ipc/approval-ipc.ts
src/main/ipc/ai-control-ipc.ts

existing integration target:
src/main/ipc/control-profile-ipc.ts  # RUN/START_DOWNLOAD must use the Broker
```

命名只是推荐；实现计划必须先检查当前目录模式。不要把全部 feature 状态继续加入 `app-store.ts`；活动流可用独立 store/reducer。

## 10. 存储与数据位置

| 数据 | 位置 | 策略 |
| --- | --- | --- |
| workspace/config/control profile | 现有 `<root>/.linkterm/` | 继续作为工程事实源，不存 secrets |
| connection profile / credential | 现有 main-owned manager / safe storage | 不复制到 activity |
| readiness snapshot | 内存 | 随事实刷新，不长期持久化 |
| first-success UI preferences | Electron userData | recent workspace、dismissed hints；版本化 JSON |
| AI pause state | Electron userData | 重启后保持；显式恢复 |
| operation ledger | 内存 ring | 观测投影，有 cursor/truncated；不是授权 authority |
| durable activity | Electron userData JSONL | 可关闭、轮转、脱敏 |
| PreparedOperation / internal ApprovalRequest / approval grant / AuthorizationRecord / ExecutionAdmissionLease | Main 内存 | Broker/admission authority；受 quota、短时、一次性或 operation lifetime、重启失效；敏感 prepared bytes 不导出 |
| CompensationCandidate | Main 内存 | 仅来自 verified successful deployment；保存 source ref/hash/target binding，不保存 prepared bytes；重启失效 |

不需要数据库、云端 backend、账号、队列服务或网络同步。

## 11. 分阶段实现路线

每个里程碑必须是独立 OpenSpec change、实现计划和 review 单元。

### M0 — 合约与质量门禁

目标：在高风险核心 seam 上建立 characterization 和 CI。

任务：

- 为 `registerTool`、现有 approval-required confirmation、session create errored semantics、JobManager update 建立/补充 characterization tests。
- 固化 63 个 MCP 工具 operation classification 清单。
- 增加 CI：lint、build、test、license validation；安装 coverage provider 并先报告、不强设全局阈值。
- 文档化 GitNexus impact/PDG/detect_changes 门禁。

验证：现有行为无变化；全套测试新鲜通过；CI 能在 clean checkout 运行。

### M1 — Operation Event 与只读 Activity 底座

目标：所有进入 LinkTerm handler 的 MCP 调用可观测，但不改变业务授权。

任务：

- 实现 schema、state machine、redactor、memory ledger、snapshot/cursor。
- 在 registry 旁路记录逻辑 Operation 与独立 CallAttempt lifecycle。
- 接入 workflow job update 和少量 human IPC action。
- IPC/preload 暴露 snapshot + event。
- 先不落盘、不审批、不暂停。

验证：每个进入 handler 的调用都有唯一 `callId` 与一个 terminal callPhase；普通调用的 operation 一对一；双状态机 fixture 证明未来审批 retry 可复用 server-side `operationId`，但生产 approval continuation 直到 M5 才启用。ledger failure 不改变普通业务结果但产生 health diagnostic；敏感样本不会进入 event。

### M2 — Activity Center 与 AI 状态

目标：用户实时看见 AI 当前和历史动作。

任务：

- 实现独立 activity store/reducer、AiStatusCapsule、drawer、筛选和详情。
- 暴露 JobManager list/subscribe，使 AI workflow 对 UI 可见并可展示 step。
- 默认只显示 active/attention/pending 和 AI correlation groups；read-only burst 折叠，但所有保留期内的 call/operation 可筛选查询。
- 至少实现 Go to session、Diagnose、Copy summary 三个上下文动作。
- OriginIndicator 点击过滤当前 session；修复 accessible name。
- AI 创建 session 改为非抢焦点通知，增加可选 Follow AI。

验证：AI flash workflow 的步骤与 job snapshot 一致；终端与非终端工具均可查询且 read-only burst 不制造顶层噪声；三类上下文动作可用；renderer reload 不丢 snapshot→event 间数据；terminal 性能不退化。

### M3 — Runtime Readiness 与 Start Center

目标：把当前被动空状态改为真实、任务导向入口。

任务：

- 提取通用 runtime/serial 和可选 workspace/profile read provider 为 RuntimeReadinessService；J-Link/firmware/RTT 专属检查留到 M6。
- 建立 readiness IPC/preload 和 Start Center。
- 区分 serial empty/error/loading；支持 refresh/manual input。
- 生成候选及证据，不静默选择低置信设备。
- recent profile/workspace 只做建议，不自动连接。
- recent workspace/dismissed hints 使用独立版本化 preferences adapter；损坏/未知版本回退安全默认值并给 diagnostic，不阻塞 readiness。
- readiness 使用 generation + event 更新；plan 执行前复验候选仍存在。
- M3 若先于 M4 发布，主 CTA 暂时进入现有 ConnectionDialog，或保持 feature flag，不能展示无法完成的半向导。

验证：0/1/多个端口、扫描错误、可选 workspace/profile 缺失/非法/冲突均为独立状态；重叠 refresh/latest-wins、热插拔、候选消失/重排、preferences migration/corruption 有测试；有 active session 时不抢占主界面。

### M4 — 串口 First Signal 纵向切片

目标：完成 A 的首个可发布 happy path。

任务：

- 意图→候选→plan review→connect→wait first signal。
- open 失败停留原处；errored session 不算完成。
- ObservationMonitor 持续 listen/replay，Main mint attempt/revision；Renderer 只有在对应 device 文本的 xterm completion callback/等价异步 ack 成功并推进 `lastVisibleDeviceSequence` 后才完成。
- silent timeout 转换为“已连接但无输出”及诊断动作，但 monitor/listener 保持 active 以接受 late signal。
- subscribe failure 与 silent 分开；恢复订阅后 snapshot replay，只完成一次。
- 失败/retry/reconnect 清理 attempt-owned session，旧 attempt 迟到事件不能污染新 attempt。
- 成功后可选保存现有 schema 支持的连接参数，不新增“verified/stable identity”声明。

验证：自动化覆盖 open success/failed、data before create response、data before Terminal mount、signal detected + subscribe failure、replay visible、silent→late signal、status/event race、duplicate start、reload retention、idempotent stop、Disconnect and edit/Back to session 在 ownsSession true/false 下的可见性与清理、user/transport/session-closed reason 映射、disconnect/reconnect、retry cleanup、旧 attempt 隔离、duplicate click；不完整 UTF-8 device chunk + 后续 state event 不得完成，xterm completion ack 后才完成；delayed callback、dispose/unmount 和 replay 不提前完成或重复渲染；late signal 不抢走其他 surface 焦点；手工完成真实/模拟串口演示。

### M5 — Human Approval Broker

目标：把 desktop approval-required 动作/计划从 caller acknowledgement 升级为真实一次性人类批准，并冻结不可由窗口/请求降级的 ApprovalMode。

任务：

- 实现四级 RiskPolicy、PreparedOperation/effect fingerprint、stable CallerPrincipalId、subject/continuation-bound ApprovalBroker/AuthorizationRecord、ApprovalModePolicy、per-principal+global limits/backpressure、pending 去重/队列、ApprovalSheet、authorization mapping labels、resolve IPC。
- 保留旧 `confirm` 第一层；增加 approval request/grant 第二层。
- 首先迁移现有 approval-required 清单和 control workflows；明确包含 MCP registry 以及 `registerControlProfileIpc` 的 `CONTROL_PROFILE_RUN_DOWNLOAD` / `CONTROL_PROFILE_START_DOWNLOAD` direct IPC。多步骤 workflow 使用 plan manifest，不顺便扩大弹窗范围。
- Direct Download button 只发起 prepare/plan review；现有硬编码 `confirm:true` 不得等同 grant。`approval:resolve` 不执行，批准后同一 RUN/START channel 用 approvalId continuation；RUN=sync、START=background，wrong subject/kind/surface/mode 不消费且不作废，duplicate 不重执行。
- 先冻结 desktop/headless/automation 启动策略和 legacy client capability；窗口状态不得参与授权降级。
- schema/error/version/docs 同步。

验证：AI 或 direct IPC 仅传/硬编码 `confirm=true` 在 interactive 模式仍不能执行；deny、TTL expiry、effect supersede、consumed replay、wrong principal/kind/surface/mode、quota rejection 的 effectful backend calls 为 0，且各自终态/资源释放符合 5.2；错误 consumer 保留原 grant，只有正确 consumer 的 path 内容变化、symlink swap、profile/default 更新、probe/target 变化才 supersede 并重新审批。正确 subject/continuation 只成功一次，另一 surface 从一开始就不能消费。覆盖 RUN sync/START background、approve→Renderer reload→Continue、duplicate invocation、read-only prepare allowlist/副作用调用=0、window close/minimize/crash、HTTP new socket/reconnect/stdio proxy loop、legacy client、伪造 header/args、不同 fingerprint 洪泛、hash cancel/TTL bytes release，均不能改变 mode、principal 或绕过 limits。

### M6 — Workspace、J-Link 与 RTT 扩展

目标：在 M5 真实人类审批底座上复用同一模型完成“下载并观察”。

任务：

- 增加 J-Link/firmware/RTT 专属 readiness check；复用 M3 已有 workspace/profile 通用状态，不重复实现。
- 复用 control workflow job steps 显示 connect/flash/verify/observe；任何新 Download/Flash CTA 和 guided side-effect surface 必须经过 M5 Broker，不得回退到按钮点击/`confirm:true` 授权。
- verify 成功后为该 target binding 建立/更新 Main-only CompensationCandidate，并向 Renderer 仅投影 CompensationCandidateSummary；新部署完成前保留上一 known-good candidate，失败/未知结果不得覆盖。
- J-Link/RTT first signal 使用专用诊断，不复用串口文案。
- 成功会话反向生成/更新 profile 建议，用户确认后保存。

验证：无 backend、无 probe、target 错误、firmware 路径/格式、flash 失败、verify 失败、RTT silent 均有正确 operation 和恢复建议；只有 known-good verified candidate 显示 reflash，source/hash/target 变化后隐藏/失效；所有新高影响入口均有 PreparedOperation/Broker effectful-backend=0/single-use 证据。

### M7 — Pause、Stop 与 Take Over

目标：用户可在 AI 工作时恢复控制。

任务：

- 实现 AiControlPolicy、版本化 ExecutionAdmissionLease 和 OperationAdmissionCoordinator。
- session AI writes 与 state-affecting MCP operations 接入 pause check。
- JobManager/backend 显式声明 `none | best-effort | safe-point` cancellation capability；AbortSignal 只是机制。Activity Center 按 capability 显示 `Stop at safe point`、`Request stop (best effort)` 或不显示。
- Take Over 聚焦 terminal、pause 尚未 admission 的 session AI changes、保留 human high lane。

验证：Pause 与 lease acquisition 同时发生只能一个先线性化；Pause commit 后无新 AI change 获得 lease；awaiting/approved/queued 保持 blocked，running 多步骤可继续且 UI 明示；double release 幂等、restart lease 失效；read-only 和 human/system 正常；内部 cancel state 不伪造 rollback；capability/按钮文案匹配。

### M8 — 持久审计、导出与产品化

目标：完成复盘、隐私、性能、无障碍和文档闭环。

任务：

- JSONL rotation、retention、startup interrupted recovery、clear/export。
- redaction property/fuzz tests；诊断包预览。
- virtualized timeline、batch events、性能基线。
- 中英文、keyboard、screen reader、reduced motion、小窗口。
- 更新 README、PROJECT_REQUIREMENTS、OpenSpec、MCP runbook、错误码与工具说明。

验证：异常退出后无伪终态；导出不含敏感 fixture；10k events UI 仍可用；全量质量命令通过。

## 12. 可执行构建任务清单

### T01 — 建立 OpenSpec 拆分

创建顺序：

1. `establish-characterization-ci-gates`
2. `add-operation-event-ledger`
3. `add-ai-activity-center`
4. `add-runtime-readiness-start-center`
5. `add-serial-first-signal-flow`
6. `add-human-approval-broker`
7. `extend-first-success-jlink-rtt`
8. `add-ai-pause-takeover`
9. `persist-export-activity-audit`

不得创建一个同时覆盖全部内容的 change。

### T02 — Operation schema/state machine

- 文件区域：`src/core/activity`, `src/shared`。
- 测试：Operation/CallAttempt 合法与非法转换、confirm=false→true、version/policy reject、first request/retry/duplicate/concurrent retry、paused retry、renderer approve 后 AI 未重试、blocked TTL/supersede、按 phase 的 restart recovery、终态、out-of-order、cursor truncation。

### T03 — Redaction and risk policy

- 文件区域：`src/core/activity/audit-redactor.ts`, `risk-policy.ts`。
- 测试：credentials、token、path、script、base64、binary、memory write、unknown tool fail-closed classification。

### T04 — Ledger and recorder

- 文件区域：`operation-ledger.ts`, `operation-recorder.ts`, `src/mcp/registry.ts`。
- 前置：对 `registerTool` 重新运行 GitNexus impact；HIGH 风险必须先告知用户。
- 测试：所有 success/handler error/version rejection/unexpected throw 分支 CallAttempt terminal 唯一；approval-required 不产生 operation running；SDK pre-handler validation 单独验证无普通 operation/backend 调用。

### T05 — IPC/preload activity bridge

- 文件区域：`ipc-protocol.ts`, `preload-api.ts`, `preload.ts`, `main/ipc/activity-ipc.ts`。
- 测试：snapshot/listen 竞态、unsubscribe、destroyed window、malformed payload。

### T06 — Activity Center

- 文件区域：独立 renderer feature。
- 测试：reducer、默认 active/attention/task grouping、read-only burst folding、filter/query、Go to session/Diagnose/Copy summary、a11y、progress、reload、large list、error/unknown state。

### T07 — Readiness extraction

- 实现：把 MCP runbook/app status 中可复用 provider 移入 core service；MCP handler 改为适配同一结果。
- 测试：provider partial failure、timeout、abort、redaction、no workspace。

### T08 — Device candidate resolver

- 测试：0/1/multiple、saved path/settings 仅为 likely、conflict、unknown、low-confidence no auto-submit、端口重编号与同 VID/PID 多设备。

### T09 — Start Center and first-success reducer

- 文件区域：renderer first-success feature。
- 测试：startup loading no flicker、recent profile、advanced escape、ConnectionDraft round-trip/source/connection behavior、state derivation、preferences migration/corruption。

### T10 — Serial connect + first signal

- 实现：复用 SessionManager/IPC，修正 errored semantics 的 UI 处理，不绕过 transport；实现持续 ObservationMonitor 与 revisioned firstSignal lifecycle。
- 测试：first data before/after subscribe、empty data、silent→late、status/event race、duplicate start、reload retention、idempotent stop、incomplete UTF-8 + state event、xterm delayed completion/dispose/unmount、display-unavailable→replay→completed、ownsSession true/false 的动作可见性与 Disconnect and edit/Back to session/Disconnect、disconnect reason mapping、duplicate connect、listener/timer cleanup、late signal focus policy。

### T11 — Recovery and successful connection settings

- 实现：错误分类映射为 action；保存基于成功的 connection draft，但继续使用现有 profile schema。
- 测试：失败不保存、用户取消不保存、冲突需确认、保存后路径变化不被称为 exact identity。若未来要保存 stable device identity、`lastSuccessfulSignalAt` 或 verified 状态，必须单独升级 schema、迁移和隐私规格。

### T12 — Job visibility

- 实现：暴露 JobManager list/update/cancel 的 UI-safe DTO。
- 测试：AI-created job 自动出现、step ordering、retention/truncation、cancel race。

### T13 — Approval broker

- 实现：prepare/effect fingerprint/request/resolve/consume/expire、immutable ApprovalMode、Broker limits 与 mandatory `AuthorizationRecord`。
- 测试：先证明 `confirm=true` 无 grant 时 effectful backend=0，再证明有效 grant 只执行一次；覆盖只读 prepare method allowlist/副作用 method=0、display-safe step range/parameter/target summary 与 verify semantics、artifact/path/symlink/profile/default/probe/target TOCTOU、mode 不可降级、queue/bytes/principal+global rate quotas、reconnect、hash cancel/资源释放、并发/错误主体消费，以及 AuthorizationRecord schema/serialization/capacity/append failure、ledger full、subscriber throw、disk full、consume 后 backend throw、runtime crash 的 fault injection。

### T14 — Approval-required migration

逐 surface 迁移，不做一次机械替换。必须点名覆盖 MCP registry、control workflows、runtime restart，以及 `registerControlProfileIpc` 的 `CONTROL_PROFILE_RUN_DOWNLOAD` / `CONTROL_PROFILE_START_DOWNLOAD`；移除“Download click 或硬编码 confirm=true 自动授权”的语义。每批运行 tool description、confirmation 和 backend fake tests，并验证 MCP/IPC 不能双消费同一 grant。

### T15 — Workspace/J-Link/RTT extension

- 实现：在 Phase 5 Broker 上增加 J-Link/firmware/RTT readiness、download + observe job visibility、specialized diagnostics、profile suggestion、Main-only CompensationCandidate 与 safe summary；任何新 Download/Flash/reflash CTA 都走 PreparedOperation/Broker。
- 测试：backend/probe/target/firmware/flash/verify/RTT silent 全路径；新高影响入口 effectful-backend=0/single-use；verified success 才更新 candidate，source/hash/target mismatch 隐藏 reflash 并重新审批。

### T16 — AI pause/takeover

- 实现：接入 OperationAdmissionCoordinator、版本化 lease 和 session writes；不要只禁用 UI 按钮。backend/job 输出 cancellation capability，不能把 AbortSignal 等同 safe point。
- 测试：lease/epoch 线性化：pre-admission、awaiting approval、approved、queued、running multi-step、session write、lease acquisition vs Pause、double release、runtime restart invalidation、pause/resume 并发、人类高优先级、read-only allow、resume persistence，以及三档 cancellation UI。

### T17 — Persistence/export

- 实现：JSONL writer、rotation、retention、startup recovery、clear/export。
- 测试：破损尾行、磁盘满/权限、redaction、atomic sequence、disabled persistence。

### T18 — UX/a11y/i18n/performance

补全 UI brief 状态矩阵，建立 event throughput 与 terminal latency baseline。

### T19 — Documentation and release gate

同步用户帮助、MCP schema/runbook、OpenSpec、工具数、error code、license（若新增依赖）和 CI。

## 13. 测试策略

### Unit

- Readiness provider aggregation、candidate confidence、ConnectionDraft round-trip、CompensationCandidate known-good update/expiry、first-success reducer/ObservationMonitor revision/lifecycle/cleanup。
- Operation/CallAttempt precondition/retry/restart state machine、ledger cursor/truncation、view reducer。
- RiskPolicy 完整性、read-only prepare facade、PreparedOperation/effect fingerprint/limits、stable principal mapping、subject/continuation-bound grant TTL/single use、AuthorizationRecord atomic transition、ApprovalMode 不可变性。
- Redactor property-based/fuzz fixtures。
- AI pause epoch/ExecutionAdmissionLease/lock ordering/double release/restart invalidation。

### Integration

- registry → recorder → ledger 的 success/error/version/schema 全路径。
- MCP approval-required action/plan → approval request → human resolve → retry → backend。
- direct Control Profile RUN/START_DOWNLOAD IPC → prepare/sheet/resolve-only/second invocation → sync result/background job；approve→reload→Continue、duplicate、close/cancel race。
- expiry → expired/release；正确 consumer 的 effect/new intent change → superseded/new approval；consumed replay → preserve original/no reexecute；wrong principal/kind/surface/mode → effectful backend=0 且原 grant 保留。
- HTTP new socket/reconnect/stdio proxy loop 命中同一 principal limiter；per-principal 与 global buckets、正确 consumer 一次、错误 consumer 为 0。
- path content、symlink、profile/default、probe/target TOCTOU → superseded/effectful backend=0。
- first approval request、pending retry、approved retry、duplicate/concurrent retry、批准后未重试的 operation/call identity。
- Broker quota/AuthorizationRecord/ledger/store fault injection，断言 grant state、resource release、backend count 和 at-most-once authorization。
- JobManager → Activity step timeline → declared cancellation capability → internal cancel lifecycle。
- verified deployment updates CompensationCandidate；failed/unknown deployment does not；source/hash/target mismatch hides recovery and reflash creates a new approval。
- session AI/human writes 与 pause/takeover 的 ordered stream。
- serial create/open → data detected → xterm completion ack 后 visible，以及 silent→late/subscribe failure/status-event race/reload/UTF-8 partial/delayed ack/dispose/disconnect/edit/retry/attempt isolation。
- Renderer snapshot + event hydration 无丢失/重复。

### Renderer

- Start Center 所有状态。
- 0/1/multiple device candidates 和 manual entry。
- Activity default grouping/query、filters、expand/collapse、pending queue/dedupe/queue-full/rate-limited/expired-not-reviewed、approved-but-paused/ready-to-continue、focus return、上下文动作。
- 映射测试覆盖 Approval not required、Client acknowledgement required、Client acknowledged — not authorized、Approved once by you、Authorized by local automation rule；文字、图标和 screen-reader label 不混淆。
- ApprovalSheet 从 step summary 渲染精确 range/target；artifact hash 只标识输入，verify 文案与 backend capability 一致。
- screen reader labels、keyboard、reduced motion、中英文。
- AI-created session 不抢占正在输入的 terminal。

### End-to-end / Manual

- 干净环境 → 串口扫描 → 连接 → signal detected → terminal visible → 可选保存连接参数。
- 空设备、端口占用、错误波特率、静默固件、热拔插。
- AI 与 direct Download button 分别发起 flash → UI consequence plan → approve → steps → OperationReceipt。
- deny、expire、changed effect、queue full、Pause、Stop at safe point/Request stop (best effort)、Take Over。
- App/renderer 重启时 running operation 标记 interrupted/恢复 snapshot。
- Windows 实机；macOS/Linux 至少运行核心/transport fake 自动化，发布前再决定安装级矩阵。

## 14. 验证命令

每个 change 至少执行相关单测；里程碑完成必须执行：

```powershell
pnpm run lint
pnpm run build
pnpm test
pnpm run validate:licenses
pnpm audit --prod
node .gitnexus/run.cjs analyze
```

安全/影响补充：

- 修改任何函数/类/方法前运行 GitNexus upstream impact。
- 修改 `registerTool`、approval、path/command/redaction 后运行 PDG/taint explain 与定向 `pdg_query`。
- 提交前运行 `detect_changes({scope: "all"})`；回归评审使用 `base_ref: "main"`。
- 不以 `0 taint findings` 代替安全评审。

## 15. 性能和可靠性预算

- Activity instrumentation 不得同步等待 Renderer。
- terminal 高频 data event 不逐字节进入 Activity Ledger；只记录 operation/milestone 和 cursor 引用。
- Start Center readiness 建议在 2 秒内展示部分结果；慢 provider 独立更新。
- App 打开后 200ms 内可显示已存在的 running operation snapshot（数据可用时）。
- Activity Center 默认只渲染可见/最近项；10k 持久事件不应一次进入 DOM。
- ApprovalBroker 默认限制 16 pending/runtime、8 pending/principal、64 MiB/artifact、256 MiB prepared/runtime、20 prepares/min/principal、100 prepares/min global；超限在读取/提交大对象前尽早背压，重连不重置 principal bucket。
- ledger/store 写失败产生明确 diagnostic，不得阻塞 normal terminal write。
- Broker mandatory AuthorizationRecord/consume 失败必须 fail closed；best-effort ledger/durable store 失败产生 health diagnostic，不反向改变已完成授权状态。
- renderer reload、MCP reconnect、runtime restart 分别有不同恢复语义。

## 16. 安全与隐私

- Main Process 是 human approval 的信任边界；Renderer 只提交用户选择，MCP 无 resolve 能力。
- BrowserWindow 必须保持 contextIsolation，审批 IPC 验证 sender。
- 不把 client correlationId、displayName 或 `confirm=true` 当身份/授权。
- 当前单 Bearer token 不能区分多个 Agent；它映射为一个稳定 local-MCP principal，UI 文案第一阶段显示“本机 MCP Agent”，不虚构厂商身份。
- operation log 不是 transcript 备份。
- 当前计划不实现 checkpoint。若宿主或未来版本提供文件/config checkpoint，可明确展示其覆盖范围；`OperationReceipt` 只是证据，不是恢复点。
- flash/erase/reset 不称为 undo。只有有效 CompensationCandidate 的 known-good artifact source/hash 与 target binding 复验通过且再次获批时，才可建议补偿性 reflash；不能从 OperationReceipt 猜测，也不能承诺恢复设备先前状态。
- persistence 可关闭、可清除、可预览导出。
- PDG/taint 有 closure/property/implicit-flow 限制，安全结论需人工复核。

## 17. 兼容与迁移

- M1/M2 只增加旁路事件，不改变 tool result 或授权。
- 新 `operationId`/`callId` 优先放 evidence.meta，避免破坏顶层固定 shape。
- Approval 是单独 schema/version 变更，保留现有 `confirm` 作为第一层 client acknowledgement。
- Control Profile direct download IPC 同期迁移；原硬编码 `confirm:true` 不能保留为授权捷径。
- ApprovalMode 在 M5 前必须冻结并写入 app status/runbook；desktop 不因窗口状态降级，headless 默认为 deny，automation 必须显式 allowlist。
- legacy client 无 capability/retry 时 fail closed 并返回升级提示；这是语义 breaking change，必须有 schema/version/兼容测试。
- Activity persistence schema 带版本；未知版本只读/忽略并提示，不自动破坏文件。
- 现有 control profile/workspace schema 不因 UI 向导而改名。
- 不自动迁移或上传旧 transcript/job；重启前历史没有 operation ledger，UI 明确从启用时间开始。

## 18. 验收标准

### Epic A

- [ ] 空状态变为任务导向 Start Center，老用户可直接进入高级连接。
- [ ] readiness 区分 loading/empty/error/blocked/ready。
- [ ] 多设备不静默选择；无设备可 refresh/manual/diagnose。
- [ ] open、data received、signal visible、silent 和 subscribe failure 是独立状态；检测到但未显示时不得完成。
- [ ] silent 是非终态；持续 listener 能观察 late signal，firstSignal start/status/event/stop 有 attemptId/revision/幂等/reload/cleanup 契约。
- [ ] `lastVisibleDeviceSequence` 只在非空 device 文本的 xterm completion callback/等价异步 ack 成功后推进；不完整 UTF-8 + state event、delayed callback、dispose/unmount 不得误完成。
- [ ] errored session 不算 journey success，用户可原地修改和重试。
- [ ] 串口 first-success 完成后可选保存成功使用的现有 connection profile；不得暗示已建立稳定设备身份。
- [ ] 数据早于 create response/Terminal mount 到达仍可检测并只渲染一次；旧 attempt 事件不能完成新 attempt。
- [ ] silent/display-unavailable 的 Keep waiting、Disconnect and edit、Back to session、Disconnect 和 replay 路径按 ownsSession 规则幂等清理，不遗留端口或 monitor；user/transport/session-closed 不混淆，late signal 不无条件抢焦点。
- [ ] Serial ConnectionDraft 可在 candidate→plan→advanced form→session create 间无损 round-trip，且明确 exclusive/control-line/reset/no-payload 行为。
- [ ] plan review 后端口消失或候选变化时执行被安全阻止并要求复验。
- [ ] J-Link/RTT 复用同一 readiness/operation/first-signal 模型。
- [ ] Reflash recovery 只由同 target 的 known-good verified CompensationCandidate 驱动，显示/点击双重复验并创建新 approval。

### Epic D

- [ ] 所有生产 MCP 工具在进入 handler 后都有 queryable CallAttempt lifecycle；每个调用唯一 terminal，approval retry 的逻辑 operation 保持稳定；pre-handler validation 单列 diagnostic。
- [ ] missing confirm/version/policy/Pause/restart 的 pre-admission mapping 不遗留永久 requested/blocked operation，也不把未执行请求标为 interrupted。
- [ ] 终端与非终端 AI 操作在 Activity Center 可查询；默认 UI 聚合 active/attention/task，read-only burst 不制造顶层噪声。
- [ ] workflow steps/progress、失败影响和 next actions 可见。
- [ ] Activity 至少提供 Go to session、Diagnose、Copy summary。
- [ ] `interactive-required` 动作/计划仅凭 `confirm=true` 无法执行；window/renderer/transport/client 状态不能降级 ApprovalMode。
- [ ] MCP 与 Control Profile direct RUN/START_DOWNLOAD IPC 都经 PreparedOperation/Broker；approval:resolve/button/硬编码 confirm 不执行，direct 使用两次 invocation，RUN/START mode 固定。
- [ ] grant 绑定 PreparedOperation、stable principal、continuation kind/surface/mode、短时且一次性；wrong subject/kind/surface/mode 的 effectful backend 为 0 且不作废，正确 consumer 一次，expiry/supersede/replay/quota 各有明确终态与资源释放。
- [ ] Main-only PreparedOperation/Grant/AuthorizationRecord/CallerPrincipalId/CompensationCandidate/Lease 不跨 preload；Renderer 只收到 display-safe approval、authorization 和 compensation projections。
- [ ] AI Pause 对尚未 admission 的 changes 生效，ExecutionAdmissionLease/running 边界及 human/system/read-only 符合策略。
- [ ] global/session Pause 采用 OR，任一局部 Resume 不能越过另一 latch；session lease 同时复验 global/session epochs。
- [ ] UI 区分 client acknowledgement、human approval、automation rule authorization，screen-reader 文本不同。
- [ ] Stop at safe point / Request stop (best effort) / no control 与 backend capability 一致；内部 cancel-requested/cancelled 不冒充 rollback。
- [ ] audit/export 通过敏感字段测试。

### 质量

- [ ] lint/build/test/license/audit/CI 全绿。
- [ ] GitNexus impact/detect_changes 范围符合预期。
- [ ] 中英文、键盘、screen reader、reduced motion、小窗口完成验收。
- [ ] 相关文档、OpenSpec、schema version、error code、runbook 同步。

## 19. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `registerTool` 是 HIGH-risk hub | 先 characterization +旁路事件；approval 另一个 change |
| 日志成为 secret 仓库 | allowlist redaction、敏感 fixture、默认摘要/hash |
| approval fatigue | 风险与 approval policy 分离；read-only 不弹窗；plan-scoped grant + pending 去重 |
| AI 自批准 / TOCTOU | Main-only broker、无 MCP resolve、PreparedOperation effect fingerprint、backend 前同快照执行或原子复验 |
| Direct IPC 绕过 Broker | 点名迁移 Control Profile RUN/START_DOWNLOAD；硬编码 confirm/button click 不授权；跨 surface single-use test |
| Prepared artifact 内存 DoS | pending/bytes/rate quotas、streaming hash/AbortSignal、TTL/终态释放、稳定 backpressure error |
| operation 与 retry 身份混淆 | server logical operationId + per-call callId；Broker 找回原 operation；双状态机测试 |
| 窗口消失导致安全降级 | Main 启动时冻结 ApprovalMode；desktop 无窗口仍 interactive-required |
| Pause 与并发请求竞态 | epoch/admission lease 线性化；running 与 Stop 分离 |
| 审批记录与授权状态分裂 | Broker `AuthorizationRecord` 为 authority；ApprovalDecisionRecord/OperationReceipt/ledger/store 分层；fault injection + at-most-once |
| 取消被误解为回滚 | 分离 stop control、cancel-requested/cancelled 与 OperationReceipt；文案按 capability |
| 向导与真实状态漂移 | readiness 派生，不持久化整个 step state |
| 错选板卡 | evidence/confidence、多候选不自动提交 |
| Silent device 被误判失败/漏掉迟到信号 | open 与 first signal 分离；silent 非终态，持续 listener + 独立 timer |
| Renderer 状态继续膨胀 | 独立 feature reducer/store，不塞进 App/app-store |
| Activity 影响 terminal 性能 | milestone-only、异步 append、有界/虚拟列表、基准测试 |

## 20. 构建前已确认决策

1. **交付顺序**：采用 M0 → Ledger → Activity → Readiness → Serial → Human Approval → J-Link/RTT → Pause/Take Over → Audit。
2. **ApprovalMode 默认**：desktop=`interactive-required`、headless=`headless-deny`；首版不启用 `automation-allowlisted`。
3. **持久审计默认**：脱敏 durable audit 默认开启，保留 30 天，单文件 10 MiB 轮转。
4. **首发平台矩阵**：Windows-first 手工验收 + Windows/macOS/Linux 核心自动化兼容。

窗口失焦时的脱敏 OS approval notification 是可选 UX 决策，不阻塞 Phase 0。四项关键产品默认值已经审阅并冻结；可信启动入口、legacy capability 和持久化 API 的精确设计仍须分别在 M5/M8 的独立 OpenSpec 中完成，但不得改变上述默认值。
