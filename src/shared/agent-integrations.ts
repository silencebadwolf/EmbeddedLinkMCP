/** Agent MCP integration target identifier. */
export type CodexWslAgentIntegrationTargetId = `codex:wsl:${string}:${string}`;

export type AgentIntegrationTargetId =
  | 'vscode'
  | 'cursor'
  | 'claude-desktop'
  | 'codex'
  | CodexWslAgentIntegrationTargetId
  | 'windsurf'
  | 'cline'
  | 'roo-code';

/** Supported external config layout. */
export type AgentIntegrationConfigKind =
  | 'vscode-mcp-json'
  | 'vscode-settings'
  | 'mcp-servers'
  | 'codex-config-toml';

/** Host environment where the external agent configuration lives. */
export type AgentIntegrationPlatform = 'windows' | 'wsl';

/** LinkTerm MCP stdio launch config written into external agent configuration. */
export interface LinkTermMcpLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface LinkTermMcpStdioTransport {
  type: 'stdio';
  launchConfig: LinkTermMcpLaunchConfig;
}

export interface LinkTermMcpHttpTransport {
  type: 'http';
  url: string;
  bearerTokenEnvVar?: string;
}

export type LinkTermMcpTransport =
  | LinkTermMcpStdioTransport
  | LinkTermMcpHttpTransport;

/** A concrete agent config file location to inspect and update. */
export interface AgentIntegrationTarget {
  id: AgentIntegrationTargetId;
  label: string;
  configPath: string;
  wslConfigPath?: string;
  configKind: AgentIntegrationConfigKind;
  launchConfig?: LinkTermMcpLaunchConfig;
  transport?: LinkTermMcpTransport;
  platform?: AgentIntegrationPlatform;
  locationLabel?: string;
}

/** Installation state for one supported agent. */
export type AgentIntegrationStatusKind =
  | 'not-found'
  | 'invalid-json'
  | 'not-configured'
  | 'needs-update'
  | 'configured';

/** Renderer-visible status for one agent integration target. */
export interface AgentIntegrationStatus {
  id: AgentIntegrationTargetId;
  label: string;
  configPath: string;
  configKind: AgentIntegrationConfigKind;
  platform?: AgentIntegrationPlatform;
  locationLabel?: string;
  transportLabel?: 'HTTP' | 'stdio';
  status: AgentIntegrationStatusKind;
  configured: boolean;
  canInstall: boolean;
  backupPath?: string;
  message?: string;
}

/** Result returned after installing or repairing one agent integration. */
export interface AgentIntegrationInstallResult {
  status: AgentIntegrationStatus;
  backupPath?: string;
}

export type AgentIntegrationDiagnosticCheckStatus = 'pass' | 'warn' | 'fail';

export interface AgentIntegrationDiagnosticCheck {
  id: string;
  label: string;
  status: AgentIntegrationDiagnosticCheckStatus;
  message?: string;
}

export interface AgentIntegrationDiagnosticResult {
  targetId: AgentIntegrationTargetId;
  label: string;
  transport: 'HTTP' | 'stdio';
  checks: AgentIntegrationDiagnosticCheck[];
}
