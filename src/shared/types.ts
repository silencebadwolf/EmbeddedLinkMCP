/**
 * 跨进程共享类型定义。
 *
 * 主进程、渲染进程、MCP server 都从此处导入会话基础类型；
 * 当 IPC 序列化时这些类型也用作通信契约，**禁止在此引入运行时依赖或 Electron API**。
 */

/** 全局唯一的会话标识。SessionManager 用 `sess_<uuid>` 形式生成。 */
export type SessionId = string;

/** 支持的连接类型。 */
export type ConnectionType = 'serial' | 'ssh' | 'local-shell';

/**
 * 串口工作模式。
 * - normal: 原始字节透传，不做行尾/回显处理
 * - terminal: 启用嵌入式终端规则（Phase 7 引入），支持 sendAndWait
 */
export type SerialMode = 'normal' | 'terminal';

/**
 * 写入/事件来源标签。
 * - human: 人类通过 UI 操作
 * - ai: MCP 客户端（AI agent）
 * - device: 来自远端设备的入站数据
 * - system: 系统自身（状态变化、错误等）
 */
export type Origin = 'human' | 'ai' | 'device' | 'system';

/**
 * MCP 工具返回的证据种类（用于 evidence.kind 字段，Phase 4+ 使用）。
 */
export type EvidenceKind =
  | 'raw_bytes'
  | 'terminal_output'
  | 'debug_output'
  | 'ui_screenshot'
  | 'workspace_config';

/**
 * 会话生命周期状态。
 * - idle: 已创建但 transport 尚未打开
 * - opening: transport.open() 进行中
 * - open: transport 已就绪，可读写
 * - closing: 主动关闭中
 * - closed: 已正常关闭
 * - errored: transport 报错或 open 失败，会话不可继续使用
 */
export type SessionState = 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'errored';

/**
 * 会话配置基类。具体类型通过判别字段 `type` 进行联合区分（见 AnySessionConfig）。
 */
export interface SessionConfig {
  type: ConnectionType;
  /** UI 显示名称；不影响业务逻辑。 */
  label?: string;
}

/** 串口数据位，常见嵌入式场景为 8。 */
export type SerialDataBits = 5 | 6 | 7 | 8;

/** 串口停止位，常见嵌入式场景为 1。 */
export type SerialStopBits = 1 | 1.5 | 2;

/** 串口校验位。'mark'/'space' 部分平台不支持，由 transport 层在 open 时校验。 */
export type SerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space';

/** 串口会话配置。 */
export interface SerialSessionConfig extends SessionConfig {
  type: 'serial';
  /** 系统串口路径，如 macOS `/dev/tty.usbserial-XXX`、Windows `COM3`。 */
  port: string;
  /** 波特率，如 115200。 */
  baudRate: number;
  /** 工作模式：normal 透传 / terminal 启用嵌入式规则。 */
  mode: SerialMode;
  /** 数据位，默认 8。 */
  dataBits?: SerialDataBits;
  /** 停止位，默认 1。 */
  stopBits?: SerialStopBits;
  /** 校验位，默认 'none'。 */
  parity?: SerialParity;
  /** 硬件 RTS/CTS 流控，默认 false。 */
  rtscts?: boolean;
  /** 软件 XON 流控，默认 false。 */
  xon?: boolean;
  /** 软件 XOFF 流控，默认 false。 */
  xoff?: boolean;
}

/**
 * 串口枚举单条信息。从 `serialport` 的 PortInfo 子集裁剪而来，
 * 仅包含 IPC/MCP 上下文需要的字段，避免暴露平台/驱动相关的 native 字段。
 */
export interface SerialPortInfo {
  /** 系统设备路径，如 `/dev/tty.usbserial-XXX` 或 `COM3`。 */
  path: string;
  /** 系统提供的可读设备名，如 Windows 设备管理器友好名称。 */
  friendlyName?: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
  locationId?: string;
}

/**
 * SSH 会话配置。
 *
 * **敏感字段（密码、私钥、密码短语）严禁出现在此结构中**——通过 `SshSessionOptions.credentials`
 * 单独传递，仅在 `transport.open()` 调用瞬间持有，不入字段、不入 transcript（req §4.4 / §5.1）。
 */
export interface SshSessionConfig extends SessionConfig {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
  /** keep-alive 心跳间隔（毫秒）；0 或缺省 = 关闭。 */
  keepaliveIntervalMs?: number;
  /** ssh2 ready 握手超时（毫秒），缺省使用 DEFAULT_SSH_READY_TIMEOUT_MS。 */
  readyTimeoutMs?: number;
  /** 远端 PTY 的 TERM 类型，缺省使用 DEFAULT_TERM_TYPE。 */
  term?: string;
  /** 初始终端高度（行），缺省使用 DEFAULT_PTY_ROWS。 */
  rows?: number;
  /** 初始终端宽度（列），缺省使用 DEFAULT_PTY_COLS。 */
  cols?: number;
}

/**
 * 本地 Shell（PTY）会话配置。
 *
 * 默认值：Unix 上 shell 解析为 `process.env.SHELL ?? '/bin/bash'`；
 * Windows 上为 `process.env.COMSPEC ?? 'cmd.exe'`。
 * env 缺省时**继承**完整 `process.env`；显式提供时**整体替换**（避免泄漏意外变量）。
 */
export interface LocalShellSessionConfig extends SessionConfig {
  type: 'local-shell';
  /** Shell 可执行；缺省由 transport 按平台解析。 */
  shell?: string;
  /** Shell 启动参数；缺省 []。 */
  args?: readonly string[];
  /** 工作目录；缺省 `process.cwd()`。 */
  cwd?: string;
  /** 自定义环境变量；缺省继承 `process.env`，提供时整体替换。 */
  env?: Readonly<Record<string, string>>;
  /** PTY TERM 类型，缺省使用 DEFAULT_TERM_TYPE。 */
  term?: string;
  /** 初始终端高度（行），缺省使用 DEFAULT_PTY_ROWS。 */
  rows?: number;
  /** 初始终端宽度（列），缺省使用 DEFAULT_PTY_COLS。 */
  cols?: number;
}

/** 三种会话配置的判别联合，IPC/MCP 接口使用此类型作为入参。 */
export type AnySessionConfig = SerialSessionConfig | SshSessionConfig | LocalShellSessionConfig;

/**
 * 会话元信息。由创建入口在 SessionManager 注册时写入，用于 UI 从后台 runtime 水合会话列表。
 */
export interface SessionMetadata {
  /** 连接类型，供 UI 选择图标/标签。 */
  connectionType: ConnectionType;
  /** 非敏感显示名称；不得包含密码、私钥、token 等敏感字段。 */
  label?: string;
  /** 创建来源；仅用于展示/审计，不参与权限判断。 */
  createdBy?: Origin;
  /** 串口会话的非敏感匹配键，用于控制工作流复用已打开端口。 */
  serial?: {
    /** 系统串口路径，如 COM3 或 /dev/ttyUSB0。 */
    port: string;
    /** 波特率。 */
    baudRate: number;
    /** 串口工作模式。 */
    mode: SerialMode;
  };
}

/** 后台 runtime 暴露给 UI/MCP 的会话摘要。 */
export interface SessionSummary {
  sessionId: SessionId;
  state: SessionState;
  connectionType: ConnectionType;
  label: string;
  createdBy?: Origin;
  serial?: {
    port: string;
    baudRate: number;
    mode: SerialMode;
  };
}

/** 后台 runtime 推送给 UI 的会话生命周期事件。 */
export type SessionLifecycleEvent =
  | { type: 'created'; session: SessionSummary }
  | { type: 'stateChanged'; session: SessionSummary }
  | { type: 'destroyed'; sessionId: SessionId };