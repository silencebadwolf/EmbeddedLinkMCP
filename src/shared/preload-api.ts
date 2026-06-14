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
  SerialSessionConfig,
  LocalShellSessionConfig,
  SshSessionConfig,
  SerialPortInfo,
} from './types.js';
import type { TranscriptEventEnvelope, SerializedTranscriptEvent } from './transcript-ipc-types.js';

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

/** session 命名空间下的 9 个方法。 */
export interface SessionNamespace {
  /** 创建并尝试 open；open 失败时仍返回 success=true 但 state='errored'，由 UI 决定后续动作。 */
  create(req: SessionCreateRequestPayload): Promise<PreloadResult<{ sessionId: SessionId; state: SessionState }>>;
  /** 写入字节流；origin 在主进程被强制为 'human'。 */
  write(req: SessionWriteRequestPayload): Promise<PreloadResult<{ bytesWritten: number }>>;
  /** 从 cursor 之后读取 transcript；cursor=0 表示从最早可见事件开始。 */
  read(req: SessionReadRequestPayload): Promise<PreloadResult<SessionReadSuccess>>;
  /** 在 transcript 追加 clear 事件（不真正删除历史）。 */
  clear(req: { sessionId: SessionId }): Promise<PreloadResult<{ sequence: number }>>;
  /** 列出当前所有活跃 session id。 */
  list(): Promise<PreloadResult<{ sessionIds: ReadonlyArray<SessionId> }>>;
  /** 查询 session 的当前 state 与最新 cursor。 */
  status(req: { sessionId: SessionId }): Promise<PreloadResult<{ sessionId: SessionId; state: SessionState; latestCursor: number }>>;
  /** 调整 PTY 窗口尺寸；串口 session 静默返回 resized=false。 */
  resize(req: { sessionId: SessionId; cols: number; rows: number }): Promise<PreloadResult<{ resized: boolean }>>;
  /** 关闭并销毁 session；保留 transcript 直到进程退出。 */
  destroy(req: { sessionId: SessionId }): Promise<PreloadResult<{ destroyed: true }>>;
  /** 订阅 session 的 transcript 增量；返回 mount-时刻的快照（events + cursor）。 */
  subscribe(req: { sessionId: SessionId }): Promise<PreloadResult<TranscriptSubscribeSuccess>>;
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
   * 注意：preload 不暴露 ipcRenderer，渲染端只能用 unsubscribe，不能用 channel.removeAllListeners。
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
 * 广播给渲染端。renderer 在 store 里 dispatch 对应 action。
 *
 * Phase 10：fire-and-forget 单向广播 —— evidence 返回的是"已发送的 patch"快照，
 * 不等待 store 应用回执。AI 客户端如需验证可立即调用 `ui_screenshot`。
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
   * 订阅 `UI_STATE_PATCH` 主→渲染推送；返回 unsubscribe。
   *
   * 与 transcript subscriber 同生命周期：webContents 销毁时主进程自动清理订阅。
   */
  onStatePatch(handler: (patch: UiStatePatch) => void): Unsubscribe;
}

/**
 * `window.linkterm` 的完整类型。
 *
 * 命名空间分组对应主进程 IPC channel 的 `<scope>:<action>` 命名（session/serial/transcript/ui）。
 */
export interface PreloadAPI {
  session: SessionNamespace;
  serial: SerialNamespace;
  transcript: TranscriptNamespace;
  ui: UiNamespace;
}

declare global {
  interface Window {
    /** preload 暴露的 LinkTerm IPC API；contextIsolation 开启时是唯一通道。 */
    linkterm: PreloadAPI;
  }
}
