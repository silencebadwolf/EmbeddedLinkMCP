// Shared type definitions — will be expanded in Phase 1

export type SessionId = string;
export type ConnectionType = 'serial' | 'ssh' | 'local-shell';
export type SerialMode = 'normal' | 'terminal';
export type Origin = 'human' | 'ai' | 'device' | 'system';
export type EvidenceKind = 'raw_bytes' | 'terminal_output' | 'debug_output' | 'ui_screenshot';

export interface SessionConfig {
  type: ConnectionType;
  label?: string;
}

export interface SerialSessionConfig extends SessionConfig {
  type: 'serial';
  port: string;
  baudRate: number;
  mode: SerialMode;
}

export interface SshSessionConfig extends SessionConfig {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
}

export interface LocalShellSessionConfig extends SessionConfig {
  type: 'local-shell';
  shell?: string;
  cwd?: string;
}

export type AnySessionConfig = SerialSessionConfig | SshSessionConfig | LocalShellSessionConfig;
