/** Agent integration IPC handler tests. */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers: map,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
        map.set(channel, fn);
      }),
      removeHandler: vi.fn((channel: string) => {
        map.delete(channel);
      }),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { AgentIntegrationManager } from '../../../../src/core/agent-integrations/index.js';
import type { registerAgentIntegrationsIpc as RegisterAgentIntegrationsIpc } from '../../../../src/main/ipc/agent-integrations-ipc.js';

let registerAgentIntegrationsIpc: typeof RegisterAgentIntegrationsIpc;

function makeManager(): AgentIntegrationManager {
  return {
    listStatuses: vi.fn(async () => [
      {
        id: 'vscode',
        label: 'VS Code Copilot',
        configPath: 'settings.json',
        configKind: 'vscode-settings',
        status: 'not-configured',
        configured: false,
        canInstall: true,
      },
    ]),
    install: vi.fn(async () => ({
      backupPath: 'settings.json.bak-20260615-080910',
      status: {
        id: 'vscode',
        label: 'VS Code Copilot',
        configPath: 'settings.json',
        configKind: 'vscode-settings',
        status: 'configured',
        configured: true,
        canInstall: false,
      },
    })),
    uninstall: vi.fn(async () => ({
      backupPath: 'settings.json.bak-20260615-080911',
      status: {
        id: 'vscode',
        label: 'VS Code Copilot',
        configPath: 'settings.json',
        configKind: 'vscode-settings',
        status: 'not-configured',
        configured: false,
        canInstall: true,
      },
    })),
    diagnose: vi.fn(async () => ({
      targetId: 'codex',
      label: 'Codex',
      transport: 'HTTP',
      checks: [{ id: 'config', label: 'Codex MCP config', status: 'pass' }],
    })),
  } as unknown as AgentIntegrationManager;
}

describe('registerAgentIntegrationsIpc', () => {
  beforeEach(async () => {
    ({ registerAgentIntegrationsIpc } = await import('../../../../src/main/ipc/agent-integrations-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('lists integration statuses', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_LIST)!;
    const result = await handler({}, undefined) as { success: boolean; data?: unknown[] };

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('installs a target by id', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL)!;
    const result = await handler({}, { targetId: 'vscode' }) as { success: boolean; data?: { backupPath?: string } };

    expect(result.success).toBe(true);
    expect(result.data?.backupPath).toBe('settings.json.bak-20260615-080910');
    expect(manager.install).toHaveBeenCalledWith('vscode');
  });

  it('accepts WSL Codex target ids from discovered status rows', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL)!;
    const result = await handler({}, { targetId: 'codex:wsl:Ubuntu-24.04:jianyin' }) as {
      success: boolean;
    };

    expect(result.success).toBe(true);
    expect(manager.install).toHaveBeenCalledWith('codex:wsl:Ubuntu-24.04:jianyin');
  });

  it('diagnoses a target by id', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_DIAGNOSE)!;
    const result = await handler({}, { targetId: 'codex' }) as {
      success: boolean;
      data?: { transport: string };
    };

    expect(result.success).toBe(true);
    expect(result.data?.transport).toBe('HTTP');
    expect(manager.diagnose).toHaveBeenCalledWith('codex');
  });

  it('uninstalls a target by id', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_UNINSTALL)!;
    const result = await handler({}, { targetId: 'vscode' }) as {
      success: boolean;
      data?: { backupPath?: string };
    };

    expect(result.success).toBe(true);
    expect(result.data?.backupPath).toBe('settings.json.bak-20260615-080911');
    expect(manager.uninstall).toHaveBeenCalledWith('vscode');
  });

  it('rejects invalid install payloads', async () => {
    const manager = makeManager();
    registerAgentIntegrationsIpc(manager);

    const handler = handlers.get(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL)!;
    const result = await handler({}, {}) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('dispose unregisters handlers', () => {
    const dispose = registerAgentIntegrationsIpc(makeManager());
    dispose();

    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_INTEGRATIONS_LIST);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_INTEGRATIONS_UNINSTALL);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_INTEGRATIONS_DIAGNOSE);
  });
});
