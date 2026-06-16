/** Agent MCP integration target identifier. */
export type AgentIntegrationTargetId =
  | 'vscode'
  | 'cursor'
  | 'claude-desktop'
  | 'windsurf'
  | 'cline'
  | 'roo-code';

/** Supported external config layout. */
export type AgentIntegrationConfigKind = 'vscode-mcp-json' | 'vscode-settings' | 'mcp-servers';

/** LinkTerm MCP stdio launch config written into external agent configuration. */
export interface LinkTermMcpLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** A concrete agent config file location to inspect and update. */
export interface AgentIntegrationTarget {
  id: AgentIntegrationTargetId;
  label: string;
  configPath: string;
  configKind: AgentIntegrationConfigKind;
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
