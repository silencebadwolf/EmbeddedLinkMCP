import { ipcMain } from 'electron';
import type {
  AgentIntegrationInstallResult,
  AgentIntegrationStatus,
  AgentIntegrationTargetId,
  AgentIntegrationManager,
} from '../../core/agent-integrations/index.js';
import { AgentConfigInvalidJsonError, AgentIntegrationTargetNotFoundError } from '../../core/agent-integrations/index.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { PreloadResult } from '../../shared/preload-api.js';

/** Register IPC handlers for local Agent MCP integration detection and installation. */
export function registerAgentIntegrationsIpc(manager: AgentIntegrationManager): () => void {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_INTEGRATIONS_LIST,
    async (): Promise<PreloadResult<ReadonlyArray<AgentIntegrationStatus>>> => {
      try {
        return { success: true, data: await manager.listStatuses() };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL,
    async (_event, raw: unknown): Promise<PreloadResult<AgentIntegrationInstallResult>> => {
      try {
        const targetId = parseTargetId(raw);
        return { success: true, data: await manager.install(targetId) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_INTEGRATIONS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL);
  };
}

function parseTargetId(raw: unknown): AgentIntegrationTargetId {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const targetId = (raw as { targetId?: unknown }).targetId;
  if (!isTargetId(targetId)) throw new Error('targetId is required');
  return targetId;
}

function isTargetId(value: unknown): value is AgentIntegrationTargetId {
  return (
    value === 'vscode' ||
    value === 'cursor' ||
    value === 'claude-desktop' ||
    value === 'windsurf' ||
    value === 'cline' ||
    value === 'roo-code'
  );
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  if (err instanceof AgentConfigInvalidJsonError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof AgentIntegrationTargetNotFoundError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
