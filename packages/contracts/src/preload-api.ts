/**
 * Shared client DTOs and API namespaces. All imports in this module are type-only.
 * PreloadAPI is retained for compatibility; hosts can use the ClientAPI alias.
 */

import type {
  SessionId,
  SessionState,
  SessionLifecycleEvent,
  SessionSummary,
  SerialSessionConfig,
  LocalShellSessionConfig,
  SshSessionConfig,
  SerialPortInfo,
  ConnectionType,
  SerialDataBits,
  SerialStopBits,
  SerialParity,
  StableSerialIdentity,
} from './types.js';
import type { TranscriptEventEnvelope, SerializedTranscriptEvent } from './transcript-ipc-types.js';
import type {
  AgentIntegrationInstallResult,
  AgentIntegrationUninstallResult,
  AgentIntegrationDiagnosticResult,
  AgentIntegrationStatus,
  AgentIntegrationTargetId,
} from './agent-integrations.js';
import type {
  ActivityCursorRequest,
  ActivityEventView,
  ActivitySnapshotView,
} from './activity-contract.js';
import type {
  AuditClearResult,
  AuditClearRequest,
  AuditExportRequest,
  AuditExportResult,
  AuditStoreStatus,
} from './audit-contract.js';
import type {
  ReadinessEvent,
  ReadinessSeverity,
  RuntimeReadinessSnapshot,
  SafeReadinessCode,
  SerialConnectionDraft,
} from './readiness-contract.js';
import type {
  FirstSignalEvent,
  FirstSignalStartRequest,
  FirstSignalStartResult,
  FirstSignalStatusRequest,
  FirstSignalStatusResult,
  FirstSignalStopRequest,
  FirstSignalStopResult,
  FirstSignalSubscribeRequest,
} from './first-signal-contract.js';
import type { CancellationCapability } from './control-workflow-contract.js';
export type {
  AgentIntegrationInstallResult,
  AgentIntegrationUninstallResult,
  AgentIntegrationDiagnosticResult,
  AgentIntegrationStatus,
  AgentIntegrationTargetId,
} from './agent-integrations.js';

/**
 * IPC 标准成功结果。
 *
 * 主进程 IPC handler 与 preload 层共用此类型 —— 此前 main 侧曾有同形 `IpcResult` /
 * `IpcOk` / `IpcErr`，Phase 6 评审统一收敛到 shared 命名空间，避免双写漂移。
 */
export type PreloadOk<T> = { success: true; data: T };
/** IPC 标准失败结果（与 wrap()/ToolError display-safe 输出对齐）。 */
export type PreloadFail = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};
/** 主进程任意 invoke 的统一返回壳。 */
export type PreloadResult<T> = PreloadOk<T> | PreloadFail;

/** 长寿命订阅返回的取消函数。 */
export type Unsubscribe = () => void;

/**
 * SSH 凭据载荷 —— 仅在 `session:create` IPC 入参瞬时持有，由 main 侧的
 * `buildSession()` 立即转换为 `SshTransport` 构造参数后即被丢弃。
 *
 * 不进入 `SshSessionConfig`，不进 transcript（req §4.4 / §5.1）。
 */
export type SshCredentialsPayload =
  | { kind: 'password'; password: string }
  | { kind: 'privateKey'; privateKey: string; passphrase?: string };

/**
 * SSH 会话创建载荷 —— `SshSessionConfig` + 必填 `credentials`。
 *
 * 使用此独立类型而非把 credentials 强塞进 `SshSessionConfig` 是为了让 TS 在 IPC 边界
 * 显式表达 "凭据是 create-time 一次性参数"，避免双层 cast 走私。
 */
export type SshSessionConfigWithCredentials = SshSessionConfig & {
  credentials: SshCredentialsPayload;
};

/**
 * `session:create` IPC 入参中 `config` 字段的合法形态联合。
 *
 * 与 `AnySessionConfig` 的差异：SSH 分支必须随附 `credentials`（不存放在 config 内）。
 * 仅供 IPC `session:create` 与 MCP `open_session` 入口消费。
 */
export type SessionCreateRequestConfig =
  | SerialSessionConfig
  | LocalShellSessionConfig
  | SshSessionConfigWithCredentials;

/** session.create 入参；与 `session-create-handler.SessionCreateRequest` 同形。 */
export interface SessionCreateRequestPayload {
  config: SessionCreateRequestConfig;
  sessionId?: string;
  label?: string;
}

/** session.write 入参；origin 强制 'human'，渲染端无法覆盖。 */
export interface SessionWriteRequestPayload {
  sessionId: SessionId;
  /** base64 编码字节流；空字符串视为 0 字节合法写入。 */
  dataBase64: string;
  correlationId?: string;
  /** 仅人触发的 Ctrl-C / abort 应当为 'high'，UI 默认 'normal'。 */
  priority?: 'high' | 'normal';
}

/** session.read 入参。 */
export interface SessionReadRequestPayload {
  sessionId: SessionId;
  cursor?: number;
}

/** session.read 的成功负载。 */
export interface SessionReadSuccess {
  events: ReadonlyArray<SerializedTranscriptEvent>;
  cursor: number;
  truncated: boolean;
  oldestAvailableSequence: number;
}

/** transcript.subscribe 的成功负载（与 read 同构）。 */
export type TranscriptSubscribeSuccess = SessionReadSuccess;

/** rttLog.open 入参。 */
export interface RttLogOpenRequestPayload {
  probeId?: string;
  root?: string;
  channelIndex?: number;
  pollIntervalMs?: number;
  maxBytesPerRead?: number;
  label?: string;
}

/** rttLog.open 成功负载。 */
export interface RttLogOpenSuccess {
  sessionId: SessionId;
  state: SessionState;
  reused: boolean;
  probeId?: string;
  channelIndex?: number;
}

/** 保存连接里可持久化的 RTT 日志目标配置。 */
export interface RttLogConnectionConfig {
  type: 'rtt-log';
  root?: string;
  probeId?: string;
  channelIndex: number;
  pollIntervalMs?: number;
  maxBytesPerRead?: number;
}

/** 保存连接 profile 里的 RTT 日志目标；必须使用稳定 workspace root。 */
export type RttLogSavedConnectionConfig = RttLogConnectionConfig & {
  root: string;
  probeId?: never;
};

/** 保存连接 profile 的入参配置；RTT 不属于 generic session:create，但允许保存。 */
export type SaveConnectionProfileConfig =
  | (SerialSessionConfig & StableSerialIdentity)
  | LocalShellSessionConfig
  | SshSessionConfigWithCredentials
  | RttLogSavedConnectionConfig;

/** 编辑保存连接时的配置；SSH 凭据可省略，以便主进程保留原有密文。 */
export type UpdateConnectionProfileConfig =
  | (SerialSessionConfig & StableSerialIdentity)
  | LocalShellSessionConfig
  | (SshSessionConfig & { credentials?: SshCredentialsPayload })
  | RttLogSavedConnectionConfig;

export type ConnectionCredentialAction = 'preserve' | 'replace' | 'clear';

/** 原位更新保存连接的入参；expectedUpdatedAt 用于阻止覆盖并发修改。 */
export interface UpdateConnectionProfileRequest {
  profileId: ConnectionProfileId;
  expectedUpdatedAt: string;
  label: string;
  config: UpdateConnectionProfileConfig;
  credentialAction?: ConnectionCredentialAction;
}

/** 保存连接打开后的统一结果；RTT 分支携带解析后的 runtime probe/channel 元信息。 */
export interface SavedConnectionOpenSuccess {
  profile: SavedConnectionSummary;
  sessionId: SessionId;
  state: SessionState;
  rttLog?: {
    probeId: string;
    channelIndex: number;
  };
}

/** session 命名空间下的方法。 */
export interface SessionNamespace {
  /** 创建并尝试 open；open 失败时仍返回 success=true 但 state='errored'，由 UI 决定后续动作。 */
  create(
    req: SessionCreateRequestPayload,
  ): Promise<PreloadResult<{ sessionId: SessionId; state: SessionState }>>;
  /** 写入字节流；origin 在主进程被强制为 'human'。 */
  write(req: SessionWriteRequestPayload): Promise<PreloadResult<{ bytesWritten: number }>>;
  /** 从 cursor 之后读取 transcript；cursor=0 表示从最早可见事件开始。 */
  read(req: SessionReadRequestPayload): Promise<PreloadResult<SessionReadSuccess>>;
  /** 在 transcript 追加 clear 事件（不真正删除历史）。 */
  clear(req: { sessionId: SessionId }): Promise<PreloadResult<{ sequence: number }>>;
  /** 列出当前所有活跃 session 摘要，供 renderer 从后台 runtime 水合 tab。 */
  list(): Promise<PreloadResult<{ sessions: ReadonlyArray<SessionSummary> }>>;
  /** 查询 session 的当前 state 与最新 cursor。 */
  status(req: {
    sessionId: SessionId;
  }): Promise<PreloadResult<{ sessionId: SessionId; state: SessionState; latestCursor: number }>>;
  /** 调整 PTY 窗口尺寸；串口 session 静默返回 resized=false。 */
  resize(req: {
    sessionId: SessionId;
    cols: number;
    rows: number;
  }): Promise<PreloadResult<{ resized: boolean }>>;
  /** 关闭并销毁 session；保留 transcript 直到进程退出。 */
  destroy(req: { sessionId: SessionId }): Promise<PreloadResult<{ destroyed: true }>>;
  /** 订阅 session 生命周期变化，供 UI 在 MCP 新建/销毁会话时同步 tab。 */
  onLifecycle(handler: (event: SessionLifecycleEvent) => void): Unsubscribe;
  /** 订阅 session 的 transcript 增量；返回 mount-时刻的快照（events + cursor）。 */
  subscribe(req: { sessionId: SessionId }): Promise<PreloadResult<TranscriptSubscribeSuccess>>;
}

/** RTT 日志命名空间。 */
export interface RttLogNamespace {
  /** 打开或复用只读 RTT 日志会话。 */
  open(req: RttLogOpenRequestPayload): Promise<PreloadResult<RttLogOpenSuccess>>;
}

/** serial 命名空间。 */
export interface SerialNamespace {
  /**
   * 一次性枚举当前可用串口。
   *
   * Phase 6 评审起返回结构化 `PreloadResult<...>` —— 此前是裸 Promise，主进程异常会变成
   * `ipcRenderer.invoke` 的 reject，渲染端拿到的是 stack dump。统一壳让所有 IPC 入口
   * 错误处理路径一致。
   */
  listPorts(): Promise<PreloadResult<ReadonlyArray<SerialPortInfo>>>;
  /**
   * 订阅串口插拔变化；返回 unsubscribe 函数。
   *
   * 注意：preload 不暴露 ipcRenderer，渲染端只能用 unsubscribe，不能用 channel.removeAllListeners.
   */
  onPortChanged(handler: (ports: ReadonlyArray<SerialPortInfo>) => void): Unsubscribe;
}

/** transcript 命名空间。 */
export interface TranscriptNamespace {
  /**
   * 订阅 `transcript:event` 推送。每个 envelope 包含 sessionId + event（destroyed 信号 event=null）。
   *
   * @returns unsubscribe 函数；调用后立即解除监听。
   */
  onEvent(handler: (envelope: TranscriptEventEnvelope) => void): Unsubscribe;
}

/**
 * ConnectionDialog 可被 MCP `ui_configure` 预填的字段白名单。
 *
 * Phase 10 安全红线：**绝不允许** `sshPassword` / `sshPrivateKey` / `sshPassphrase` 出现在
 * 此结构里 —— 一旦缺失，AI 推送过来的凭据会经过主进程→渲染进程的 IPC 通道，违背
 * §4.4 / §5.1 "凭据仅在 IPC create 入参瞬时持有"约束。即便上游 schema `.strict()` 拒绝了
 * 未知键，类型层也保留同样的硬约束作为双层防护。
 */
export interface NonSensitivePrefill {
  type?: 'serial' | 'ssh' | 'local-shell' | 'rtt-log';
  label?: string;
  serialPort?: string;
  baudRate?: string;
  serialMode?: 'normal' | 'terminal';
  dataBits?: `${SerialDataBits}`;
  stopBits?: `${SerialStopBits}`;
  parity?: SerialParity;
  readinessDraftId?: SafeReadinessCode;
  readinessDraftSource?: SerialConnectionDraft['source'];
  readinessDraftCandidateId?: SafeReadinessCode;
  readinessDraftValidationStatus?: SerialConnectionDraft['validation']['status'];
  readinessDraftMayResetBoard?: boolean;
  readinessDraftSendsPayloadOnConnect?: boolean;
  sshHost?: string;
  sshPort?: string;
  sshUsername?: string;
  sshAuth?: 'password' | 'privateKey';
  localShell?: string;
  localCwd?: string;
  rttRoot?: string;
  rttProbeId?: string;
  rttChannel?: string;
  /** 仅由本地 UI 修复入口设置；不是凭据或硬件秘密。 */
  connectionProfileId?: ConnectionProfileId;
  connectionProfileUpdatedAt?: string;
}

/**
 * MCP `ui_configure` 工具的判别联合 patch；由主进程通过 `UI_STATE_PATCH` channel
 * 广播给渲染端。renderer 在 store 里 dispatch 对应 action.
 *
 * Phase 10：fire-and-forget 单向广播 —— evidence 返回的是"已发送的 patch"快照，
 * 不等待 store 应用回执。AI 客户端如需验证可立即调用 `ui_screenshot`.
 */
export type UiStatePatch =
  | { action: 'set_locale'; locale: 'en' | 'zh' }
  | { action: 'set_connection_type'; type: 'serial' | 'ssh' | 'local-shell' | 'rtt-log' }
  | { action: 'open_connection_dialog'; prefill?: NonSensitivePrefill }
  | { action: 'close_connection_dialog' };

/**
 * `window.linkterm.ui` 命名空间。
 *
 * 仅暴露订阅入口（与 `transcript.onEvent` 模式一致）；写入只走 MCP 工具受信通道，
 * 渲染端不能伪造 patch 来源。
 */
export interface UiNamespace {
  /**
   * 订阅 `UI_STATE_PATCH` 主→渲染推送；返回 unsubscribe.
   *
   * 与 transcript subscriber 同生命周期：webContents 销毁时主进程自动清理订阅.
   */
  onStatePatch(handler: (patch: UiStatePatch) => void): Unsubscribe;
}

/** Operation/Event Ledger 活动流命名空间。 */
export interface ActivityNamespace {
  /** 订阅 activity 增量事件，并返回指定 cursor 后的初始快照。 */
  subscribe(req?: ActivityCursorRequest): Promise<PreloadResult<ActivitySnapshotView>>;
  /** 只读取指定 cursor 后的快照，不建立长期订阅。 */
  snapshot(req?: ActivityCursorRequest): Promise<PreloadResult<ActivitySnapshotView>>;
  /** 显式解除当前 renderer 对 activity 增量事件的订阅。 */
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  /** 订阅 Main 推送的 display-safe activity 事件。 */
  onEvent(handler: (event: ActivityEventView) => void): Unsubscribe;
  /** 读取 Main-owned durable audit 状态；只返回 display-safe 统计。 */
  status(): Promise<PreloadResult<{ readonly status: AuditStoreStatus }>>;
  /** 由 Main 写出脱敏审计导出，不接受 renderer 文件路径。 */
  export(req?: AuditExportRequest): Promise<PreloadResult<AuditExportResult>>;
  /** 删除本机 activity 数据；preload 只发送固定的本地删除确认标记。 */
  clear(req: AuditClearRequest): Promise<PreloadResult<AuditClearResult>>;
}

/** Runtime Readiness cursor used by renderer hydration. */
export interface ReadinessCursorRequest {
  cursor?: {
    snapshotId: SafeReadinessCode;
    generation: number;
  };
}

/** Display-safe preload-local diagnostic for malformed readiness push payloads. */
export interface ReadinessEventDiagnostic {
  readonly code: SafeReadinessCode;
  readonly severity: ReadinessSeverity;
}

/** Runtime Readiness 快照与增量事件命名空间。 */
export interface ReadinessNamespace {
  /** 读取当前 readiness 快照，不触发刷新。 */
  get(): Promise<PreloadResult<RuntimeReadinessSnapshot>>;
  /** 请求 Main 重新收集只读 readiness facts，并返回最新快照。 */
  refresh(): Promise<PreloadResult<RuntimeReadinessSnapshot>>;
  /** 订阅 readiness 增量事件，并返回当前快照。 */
  subscribe(req?: ReadinessCursorRequest): Promise<PreloadResult<RuntimeReadinessSnapshot>>;
  /** 显式解除当前 renderer 对 readiness 增量事件的订阅。 */
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  /** 订阅 Main 推送的 display-safe readiness event。 */
  onEvent(
    handler: (event: ReadinessEvent) => void,
    onInvalidPayload?: (diagnostic: ReadinessEventDiagnostic) => void,
  ): Unsubscribe;
}

/** Display-safe preload-local diagnostic for malformed first-signal push payloads. */
export interface FirstSignalEventDiagnostic {
  readonly code: SafeReadinessCode;
  readonly severity: ReadinessSeverity;
}

/** Serial First Signal 观察生命周期命名空间。 */
export interface FirstSignalNamespace {
  /** 启动一个 Main-owned first-signal observation attempt。 */
  start(req: FirstSignalStartRequest): Promise<FirstSignalStartResult>;
  /** 读取指定 attempt 的最新 observation。 */
  status(req: FirstSignalStatusRequest): Promise<FirstSignalStatusResult>;
  /** 显式停止指定 first-signal observation。 */
  stop(req: FirstSignalStopRequest): Promise<FirstSignalStopResult>;
  /** 订阅 first-signal 增量事件，并返回当前 observation。 */
  subscribe(req: FirstSignalSubscribeRequest): Promise<FirstSignalStatusResult>;
  /** 解除当前 renderer 对 first-signal 增量事件的订阅。 */
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  /** 订阅 Main 推送的 display-safe first-signal event。 */
  onEvent(
    handler: (event: FirstSignalEvent) => void,
    onInvalidPayload?: (diagnostic: FirstSignalEventDiagnostic) => void,
  ): Unsubscribe;
}

/** renderer/preload 可见的保存连接 id。 */
export type ConnectionProfileId = string;

/** renderer/preload 可见的脱敏保存连接摘要。 */
export interface SavedConnectionSummary {
  id: ConnectionProfileId;
  label: string;
  type: ConnectionType;
  config:
    | (Omit<SerialSessionConfig, 'label'> & StableSerialIdentity)
    | Omit<SshSessionConfig, 'label'>
    | Omit<LocalShellSessionConfig, 'label' | 'env'>
    | RttLogSavedConnectionConfig;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 保存连接命名空间。 */
export interface ConnectionsNamespace {
  /** 列出全局保存连接；SSH 凭据仅以 hasCredential 暴露。 */
  list(): Promise<PreloadResult<ReadonlyArray<SavedConnectionSummary>>>;
  /** 保存连接 profile 并立即打开同一配置。 */
  saveAndOpen(req: {
    config: SaveConnectionProfileConfig;
    label: string;
    saveCredentials?: boolean;
  }): Promise<PreloadResult<SavedConnectionOpenSuccess>>;
  /** 原位更新 profile，不影响当前活动会话。 */
  update(req: UpdateConnectionProfileRequest): Promise<PreloadResult<SavedConnectionSummary>>;
  /** 原位更新 profile 后，用新配置打开一个会话。 */
  updateAndOpen(
    req: UpdateConnectionProfileRequest,
  ): Promise<PreloadResult<SavedConnectionOpenSuccess>>;
  /** 快捷打开已保存连接；SSH 凭据在主进程解密，不返回 renderer。 */
  open(req: { profileId: ConnectionProfileId }): Promise<PreloadResult<SavedConnectionOpenSuccess>>;
  /** 删除已保存连接。 */
  delete(req: { profileId: ConnectionProfileId }): Promise<PreloadResult<{ deleted: true }>>;
}

/** Agent MCP 集成命名空间。 */
export interface AgentIntegrationsNamespace {
  /** 检测本机支持的 Agent 配置状态。 */
  list(): Promise<PreloadResult<ReadonlyArray<AgentIntegrationStatus>>>;
  /** 安装或修复一个 Agent 的 LinkTerm MCP 配置；主进程会在写入前备份。 */
  install(req: {
    targetId: AgentIntegrationTargetId;
  }): Promise<PreloadResult<AgentIntegrationInstallResult>>;
  /** 移除一个 Agent 配置中的 LinkTerm MCP 配置；主进程会在写入前备份。 */
  uninstall(req: {
    targetId: AgentIntegrationTargetId;
  }): Promise<PreloadResult<AgentIntegrationUninstallResult>>;
  /** 诊断一个 Agent 的 LinkTerm MCP 配置与运行前置条件。 */
  diagnose(req: {
    targetId: AgentIntegrationTargetId;
  }): Promise<PreloadResult<AgentIntegrationDiagnosticResult>>;
}

/** renderer/preload 可见的 SEGGER/J-Link flash bank 元数据。 */
export interface JLinkDeviceFlashBankPayload {
  name?: string;
  baseAddress?: string;
  maxSize?: string;
  loader?: string;
}

/** renderer/preload 可见的 SEGGER/J-Link 设备库条目。 */
export interface JLinkDeviceInfoPayload {
  name: string;
  vendor?: string;
  core?: string;
  aliases?: ReadonlyArray<string>;
  jlinkScriptFile?: string;
  sourceFile: string;
  flashBanks: ReadonlyArray<JLinkDeviceFlashBankPayload>;
}

/** renderer/preload 可见的 SEGGER/J-Link 设备库搜索结果。 */
export interface JLinkDeviceSearchResultPayload {
  available: boolean;
  reason?: 'database-not-found';
  devices: ReadonlyArray<JLinkDeviceInfoPayload>;
  sourceFiles: ReadonlyArray<string>;
  queryNormalization?: { originalQuery: string; normalizedQuery: string };
}

/** J-Link 本机设备库命名空间。 */
export interface JLinkDevicesNamespace {
  /** 搜索本机 SEGGER 设备库中的已注册设备名。 */
  search(req: {
    query?: string;
    vendor?: string;
    limit?: number;
  }): Promise<PreloadResult<JLinkDeviceSearchResultPayload>>;
  /** 通过精确注册名读取一个设备库条目。 */
  get(req: { name: string }): Promise<PreloadResult<{ device?: JLinkDeviceInfoPayload }>>;
  /** 清理并重建设备库缓存。 */
  refresh(): Promise<PreloadResult<{ refreshed: true }>>;
}

/** renderer/preload 可见的工作区控制配置主体。 */
export interface ControlProfilePayload {
  serial?: {
    enabled: boolean;
    port?: string;
    baudRate?: number;
    mode?: 'normal' | 'terminal';
    hardwareIdentity?: string;
    parentIdentity?: string;
  };
  jlink?: {
    enabled: boolean;
    target?: string;
    interface?: 'swd' | 'jtag';
    speedKHz?: number | 'auto';
  };
  flash?: {
    binary?: string;
    baseAddress?: string;
    verify?: boolean;
  };
  rtt?: {
    enabled: boolean;
    channels?: number[];
    controlBlockAddress?: string;
  };
}

/** renderer/preload 可见的完整工作区控制配置。 */
export type ControlProfileFilePayload = ControlProfilePayload & {
  schemaVersion: 'linkterm-control/1.0.0';
};

export type ControlProfileRecordSourcePayload = 'manual' | 'ai';

export interface SavedControlProfileRecordPayload {
  id: string;
  label: string;
  root: string;
  source: ControlProfileRecordSourcePayload;
  profile: ControlProfileFilePayload;
  createdAt: string;
  updatedAt: string;
}

export interface ControlProfileWorkflowStepPayload {
  id: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  durationMs: number;
  evidence?: unknown;
  error?: { code: string; message: string; failureCode?: string; details?: unknown };
}

export interface ControlProfileDownloadResultPayload {
  mode: 'flash-observe' | 'debug-diagnose' | 'flash-observe-diagnose';
  root: string;
  steps: ReadonlyArray<ControlProfileWorkflowStepPayload>;
  summary: {
    serialOpened: boolean;
    probeConnected: boolean;
    gdbServerStarted: boolean;
    flashed: boolean;
    verified: boolean;
    reset: boolean;
    serialObserved: boolean;
    rttObserved: boolean;
    debugCaptured: boolean;
  };
  failedStep?: string;
  failureCode?: string;
  nextActions: ReadonlyArray<unknown>;
  blockingReasons?: ReadonlyArray<unknown>;
}

export type ControlProfileDownloadJobStatePayload =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ControlProfileDownloadJobPayload {
  jobId: string;
  state: ControlProfileDownloadJobStatePayload;
  mode: ControlProfileDownloadResultPayload['mode'];
  root: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;
  updatedAt: number;
  currentStepId?: string;
  currentStep?: ControlProfileWorkflowStepPayload;
  cancelRequested: boolean;
  cancellationCapability?: CancellationCapability;
  stopState?:
    | 'stop-requested'
    | 'cancelled'
    | 'failed-after-stop-request'
    | 'succeeded-after-stop-request';
  summary?: ControlProfileDownloadResultPayload['summary'];
  failedStep?: string;
  failureCode?: string;
  workflow?: ControlProfileDownloadResultPayload;
}

export interface ControlProfileDownloadRequestPayload {
  root: string;
  timeoutMs?: number;
}

export interface ControlProfileCompensationReflashRequestPayload {
  candidateId: string;
  timeoutMs?: number;
}

export interface ControlProfileChipProbePayload {
  probeId: string;
  target?: string;
  connected: boolean;
}

export interface JLinkVcomRecoveryPayload {
  status: 'already-available' | 'replacement-opened' | 'recovered' | 'power-cycle-required';
  record: SavedControlProfileRecordPayload;
  port?: string;
  sessionId?: string;
  sessionState?: SessionState;
  firmwareUpdateObserved: boolean;
}

/** 工作区控制配置命名空间。 */
export interface ControlProfileNamespace {
  /** 保存/覆盖 `<root>/.linkterm/control-profile.json`。 */
  save(req: {
    root: string;
    profile: ControlProfilePayload;
    recordId?: string;
    expectedUpdatedAt?: string;
  }): Promise<
    PreloadResult<{
      path: string;
      profile: ControlProfileFilePayload;
      record?: SavedControlProfileRecordPayload;
    }>
  >;
  /** 读取 `<root>/.linkterm/control-profile.json`。 */
  load(req: {
    root: string;
  }): Promise<PreloadResult<{ path: string; profile: ControlProfileFilePayload }>>;
  /** 列出全局保存的控制配置记录。 */
  listRecords(): Promise<PreloadResult<ReadonlyArray<SavedControlProfileRecordPayload>>>;
  /** 打开一套保存的控制配置，并写回它所属工作区的 control-profile.json。 */
  openRecord(req: {
    recordId: string;
  }): Promise<PreloadResult<{ path: string; record: SavedControlProfileRecordPayload }>>;
  /** 删除一套保存的控制配置记录。 */
  deleteRecord(req: { recordId: string }): Promise<PreloadResult<{ deleted: true }>>;
  /** 显式恢复 SWD 工作区的 J-Link VCOM；不会在 readiness/startup 自动执行。 */
  recoverJlinkVcom(req: {
    recordId: string;
    expectedUpdatedAt: string;
  }): Promise<PreloadResult<JLinkVcomRecoveryPayload>>;
  /** 按当前工作区 control-profile.json 执行人工下载/烧录。 */
  runDownload(
    req: ControlProfileDownloadRequestPayload,
  ): Promise<PreloadResult<ControlProfileDownloadResultPayload>>;
  /** 启动后台下载/烧录 job，并立即返回可轮询的 job 状态。 */
  startDownload(
    req: ControlProfileDownloadRequestPayload,
  ): Promise<PreloadResult<ControlProfileDownloadJobPayload>>;
  /** 从 Main-only known-good summary 直接启动一次可观察的 reflash job。 */
  startCompensationReflash(
    req: ControlProfileCompensationReflashRequestPayload,
  ): Promise<PreloadResult<ControlProfileDownloadJobPayload>>;
  /** 保存 verified J-Link/RTT profile suggestion；不触发任何硬件操作。 */
  saveProfileSuggestion(req: { suggestionId: string }): Promise<
    PreloadResult<{
      path: string;
      profile: ControlProfileFilePayload;
      record?: SavedControlProfileRecordPayload;
    }>
  >;
  /** 读取后台下载/烧录 job 的轻量状态与最新进度。 */
  getDownloadStatus(req: {
    jobId: string;
  }): Promise<PreloadResult<ControlProfileDownloadJobPayload>>;
  /** 读取后台下载/烧录 job 的完整结构化证据。 */
  readDownload(req: { jobId: string }): Promise<PreloadResult<ControlProfileDownloadJobPayload>>;
  /** 请求后台下载/烧录 job 通过既有 AbortSignal 路径停止；不承诺硬件状态复原。 */
  cancelDownload(req: { jobId: string }): Promise<PreloadResult<ControlProfileDownloadJobPayload>>;
  /** 按当前工作区 control-profile.json 只连接芯片/J-Link，不创建串口或 RTT 会话。 */
  connectChip(req: {
    root: string;
  }): Promise<PreloadResult<{ probe: ControlProfileChipProbePayload }>>;
  /** 断开芯片/J-Link 连接，不关闭串口或 RTT 会话。 */
  disconnectChip(req: {
    probeId: string;
  }): Promise<PreloadResult<{ probeId: string; disconnected: true }>>;
  /** 选择工作区目录；用户取消时 root 为 null。 */
  pickWorkspaceRoot(): Promise<PreloadResult<{ root: string | null }>>;
  /** 选择固件文件；用户取消时 path 为 null；Intel HEX/ELF 可附带检测出的 baseAddress。 */
  pickFirmwareFile(): Promise<PreloadResult<{ path: string | null; baseAddress?: string }>>;
}

/**
 * `window.linkterm` 的完整类型。
 *
 * 命名空间分组对应主进程 IPC channel 的 `<scope>:<action>` 命名（session/serial/transcript/ui）。
 */
export interface PreloadAPI {
  session: SessionNamespace;
  rttLog: RttLogNamespace;
  serial: SerialNamespace;
  transcript: TranscriptNamespace;
  ui: UiNamespace;
  activity: ActivityNamespace;
  readiness: ReadinessNamespace;
  firstSignal: FirstSignalNamespace;
  connections: ConnectionsNamespace;
  agentIntegrations: AgentIntegrationsNamespace;
  jlinkDevices: JLinkDevicesNamespace;
  controlProfile: ControlProfileNamespace;
}
