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

vi.mock('electron', () => ({ ipcMain: ipcMainMock }));

import { registerAgentIntegrationsIpc } from '../../../../src/main/ipc/agent-integrations-ipc.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { AgentIntegrationManager } from '../../../../src/core/agent-integrations/index.js';

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
  } as unknown as AgentIntegrationManager;
}

describe('registerAgentIntegrationsIpc', () => {
  beforeEach(() => {
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
  });
});
