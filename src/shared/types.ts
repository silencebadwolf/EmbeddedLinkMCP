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
export type EvidenceKind = 'raw_bytes' | 'terminal_output' | 'debug_output' | 'ui_screenshot';

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

/** 串口会话配置。 */
export interface SerialSessionConfig extends SessionConfig {
  type: 'serial';
  /** 系统串口路径，如 macOS `/dev/tty.usbserial-XXX`、Windows `COM3`。 */
  port: string;
  /** 波特率，如 115200。 */
  baudRate: number;
  /** 工作模式：normal 透传 / terminal 启用嵌入式规则。 */
  mode: SerialMode;
}

/** SSH 会话配置（敏感字段如密码/私钥单独传递，不持久化于此）。 */
export interface SshSessionConfig extends SessionConfig {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
}

/** 本地 Shell（PTY）会话配置。 */
export interface LocalShellSessionConfig extends SessionConfig {
  type: 'local-shell';
  /** Shell 可执行文件，默认值由 transport 决定（Unix=$SHELL，Windows=cmd.exe）。 */
  shell?: string;
  /** 工作目录；省略时使用 spawn 时的当前目录。 */
  cwd?: string;
}

/** 三种会话配置的判别联合，IPC/MCP 接口使用此类型作为入参。 */
export type AnySessionConfig = SerialSessionConfig | SshSessionConfig | LocalShellSessionConfig;