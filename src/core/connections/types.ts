import type {
  ConnectionType,
  LocalShellSessionConfig,
  SerialDataBits,
  SerialMode,
  SerialParity,
  SerialSessionConfig,
  SerialStopBits,
  SshSessionConfig,
} from '../../shared/types.js';
import type { SessionCreateRequestConfig } from '../../shared/preload-api.js';

export type { SavedConnectionSummary } from '../../shared/preload-api.js';

/** 全局保存连接配置文件 schema 版本。 */
export const CONNECTIONS_SCHEMA_VERSION = 'linkterm-connections/1.0.0';

/** 保存连接的全局唯一 id。 */
export type ConnectionProfileId = string;

/** 加解密 SSH 凭据的最小接口；主进程实现使用 Electron safeStorage。 */
export interface SecretCodec {
  /** 当前平台是否可安全加密。 */
  isAvailable(): boolean;
  /** 加密 UTF-8 字符串，返回可写入 JSON 的 base64 文本。 */
  encryptUtf8(value: string): string;
  /** 解密 {@link encryptUtf8} 产生的文本。 */
  decryptUtf8(value: string): string;
}

/** 串口保存配置；与 SerialSessionConfig 非敏感字段一致。 */
export interface SerialSavedConnectionConfig {
  type: 'serial';
  port: string;
  baudRate: number;
  mode: SerialMode;
  dataBits?: SerialDataBits;
  stopBits?: SerialStopBits;
  parity?: SerialParity;
  rtscts?: boolean;
  xon?: boolean;
  xoff?: boolean;
}

/** SSH 保存配置；敏感凭据只允许存在于 encryptedCredential。 */
export interface SshSavedConnectionConfig {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
  keepaliveIntervalMs?: number;
  readyTimeoutMs?: number;
  term?: string;
  rows?: number;
  cols?: number;
}

/** 本地 shell 保存配置；不保存 env，避免持久化环境变量秘密。 */
export interface LocalShellSavedConnectionConfig {
  type: 'local-shell';
  shell?: string;
  args?: readonly string[];
  cwd?: string;
  term?: string;
  rows?: number;
  cols?: number;
}

/** 保存连接的非敏感配置联合。 */
export type SavedConnectionConfig =
  | SerialSavedConnectionConfig
  | SshSavedConnectionConfig
  | LocalShellSavedConnectionConfig;

/** 加密后的凭据引用；不包含明文或凭据类型字符串。 */
export interface EncryptedCredentialBlob {
  provider: 'electron-safeStorage';
  version: 1;
  ciphertextBase64: string;
}

/** 落盘 profile；仅主进程/core 可读取完整对象。 */
export interface SavedConnectionProfile {
  id: ConnectionProfileId;
  label: string;
  type: ConnectionType;
  config: SavedConnectionConfig;
  encryptedCredential?: EncryptedCredentialBlob;
  createdAt: string;
  updatedAt: string;
}

/** connections.json 根对象。 */
export interface ConnectionsFile {
  schemaVersion: typeof CONNECTIONS_SCHEMA_VERSION;
  profiles: SavedConnectionProfile[];
}

/** 保存 profile 的入参。 */
export interface SaveConnectionProfileInput {
  label: string;
  config: SessionCreateRequestConfig;
  saveCredentials?: boolean;
}

/** 将会话配置剥离为可安全落盘的非敏感配置。 */
export function toSavedConfig(config: SessionCreateRequestConfig): SavedConnectionConfig {
  switch (config.type) {
    case 'serial':
      return {
        type: 'serial',
        port: config.port,
        baudRate: config.baudRate,
        mode: config.mode,
        ...(config.dataBits !== undefined ? { dataBits: config.dataBits } : {}),
        ...(config.stopBits !== undefined ? { stopBits: config.stopBits } : {}),
        ...(config.parity !== undefined ? { parity: config.parity } : {}),
        ...(config.rtscts !== undefined ? { rtscts: config.rtscts } : {}),
        ...(config.xon !== undefined ? { xon: config.xon } : {}),
        ...(config.xoff !== undefined ? { xoff: config.xoff } : {}),
      } satisfies SerialSavedConnectionConfig;
    case 'ssh':
      return {
        type: 'ssh',
        host: config.host,
        port: config.port,
        username: config.username,
        ...(config.keepaliveIntervalMs !== undefined
          ? { keepaliveIntervalMs: config.keepaliveIntervalMs }
          : {}),
        ...(config.readyTimeoutMs !== undefined ? { readyTimeoutMs: config.readyTimeoutMs } : {}),
        ...(config.term !== undefined ? { term: config.term } : {}),
        ...(config.rows !== undefined ? { rows: config.rows } : {}),
        ...(config.cols !== undefined ? { cols: config.cols } : {}),
      } satisfies SshSavedConnectionConfig;
    case 'local-shell':
      return {
        type: 'local-shell',
        ...(config.shell !== undefined ? { shell: config.shell } : {}),
        ...(config.args !== undefined ? { args: config.args } : {}),
        ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
        ...(config.term !== undefined ? { term: config.term } : {}),
        ...(config.rows !== undefined ? { rows: config.rows } : {}),
        ...(config.cols !== undefined ? { cols: config.cols } : {}),
      } satisfies LocalShellSavedConnectionConfig;
  }
}

/** 将脱敏保存配置转回 session 创建配置；SSH 凭据由调用者补入。 */
export function toSessionConfig(
  config: SavedConnectionConfig,
): SerialSessionConfig | LocalShellSessionConfig | SshSessionConfig {
  return { ...config };
}
