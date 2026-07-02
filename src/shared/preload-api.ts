/**
 * `window.linkterm` 的类型契约。
 *
 * preload 用 `contextBridge.exposeInMainWorld('linkterm', api)` 暴露这一对象；renderer 端通过
 * `declare global { interface Window { linkterm: PreloadAPI } }` 引用此处类型，确保两端字段一致。
 *
 * 本文件**禁止引入运行时依赖** —— 它必须能被 main / preload / renderer 三端纯类型导入，
 * 任何 import 必须是 `import type` 或来自其它纯类型 shared 文件。
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
} from './types.js';
import type { TranscriptEventEnvelope, SerializedTranscriptEvent } from './transcript-ipc-types.js';
import type {
  AgentIntegrationInstallResult,
  AgentIntegrationUninstallResult,
  AgentIntegrationDiagnosticResult,
  AgentIntegrationStatus,
  AgentIntegrationTargetId,
} from './agent-integrations.js';
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
/** IPC 标准失败结果（与 wrap() 输出对齐）。 */
export type PreloadFail = { success: false; error: { code: string; message: string } };
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
  type?: 'serial' | 'ssh' | 'local-shell';
  label?: string;
  serialPort?: string;
  baudRate?: string;
  serialMode?: 'normal' | 'terminal';
  sshHost?: string;
  sshPort?: string;
  sshUsername?: string;
  sshAuth?: 'password' | 'privateKey';
  localShell?: string;
  localCwd?: string;
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
  | { action: 'set_connection_type'; type: 'serial' | 'ssh' | 'local-shell' }
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

/** renderer/preload 可见的保存连接 id。 */
export type ConnectionProfileId = string;

/** renderer/preload 可见的脱敏保存连接摘要。 */
export interface SavedConnectionSummary {
  id: ConnectionProfileId;
  label: string;
  type: ConnectionType;
  config:
    | Omit<SerialSessionConfig, 'label'>
    | Omit<SshSessionConfig, 'label'>
    | Omit<LocalShellSessionConfig, 'label' | 'env'>;
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
    config: SessionCreateRequestConfig;
    label: string;
    saveCredentials?: boolean;
  }): Promise<
    PreloadResult<{
      profile: SavedConnectionSummary;
      sessionId: SessionId;
      state: SessionState;
    }>
  >;
  /** 快捷打开已保存连接；SSH 凭据在主进程解密，不返回 renderer。 */
  open(req: { profileId: ConnectionProfileId }): Promise<
    PreloadResult<{
      profile: SavedConnectionSummary;
      sessionId: SessionId;
      state: SessionState;
    }>
  >;
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
  status: 'passed' | 'failed' | 'skipped';
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

/** 工作区控制配置命名空间。 */
export interface ControlProfileNamespace {
  /** 保存/覆盖 `<root>/.linkterm/control-profile.json`。 */
  save(req: {
    root: string;
    profile: ControlProfilePayload;
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
  /** 按当前工作区 control-profile.json 执行人工下载/烧录。 */
  runDownload(req: {
    root: string;
    timeoutMs?: number;
  }): Promise<PreloadResult<ControlProfileDownloadResultPayload>>;
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
  connections: ConnectionsNamespace;
  agentIntegrations: AgentIntegrationsNamespace;
  jlinkDevices: JLinkDevicesNamespace;
  controlProfile: ControlProfileNamespace;
}

declare global {
  interface Window {
    /** preload 暴露的 LinkTerm IPC API；contextIsolation 开启时是唯一通道。 */
    linkterm: PreloadAPI;
  }
}
