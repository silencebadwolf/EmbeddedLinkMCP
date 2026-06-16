// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentIntegrationsPanel } from '../../../../src/renderer/components/AgentIntegrationsPanel.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const onOpenChange = vi.fn();

describe('AgentIntegrationsPanel', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    onOpenChange.mockClear();
    mock = installMockPreload();
    mock.spies.agentIntegrations.list.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'vscode',
          label: 'VS Code Copilot',
          configPath: 'C:/Users/A/AppData/Roaming/Code/User/mcp.json',
          configKind: 'vscode-mcp-json',
          status: 'not-configured',
          configured: false,
          canInstall: true,
        },
      ],
    });
  });

  it('loads detected agent integration statuses when opened', async () => {
    render(<AgentIntegrationsPanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('VS Code Copilot')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('C:/Users/A/AppData/Roaming/Code/User/mcp.json')).toBeInTheDocument();
  });

  it('installs selected integration and refreshes row status', async () => {
    mock.spies.agentIntegrations.install.mockResolvedValueOnce({
      success: true,
      data: {
        backupPath: 'C:/Users/A/AppData/Roaming/Code/User/mcp.json.bak-20260615-080910',
        status: {
          id: 'vscode',
          label: 'VS Code Copilot',
          configPath: 'C:/Users/A/AppData/Roaming/Code/User/mcp.json',
          configKind: 'vscode-mcp-json',
          status: 'configured',
          configured: true,
          canInstall: false,
          backupPath: 'C:/Users/A/AppData/Roaming/Code/User/mcp.json.bak-20260615-080910',
        },
      },
    });

    render(<AgentIntegrationsPanel open onOpenChange={onOpenChange} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Install / Repair' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install / Repair' }));

    await waitFor(() =>
      expect(mock.spies.agentIntegrations.install).toHaveBeenCalledWith({ targetId: 'vscode' }),
    );
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    expect(screen.getByText(/Backup:/)).toBeInTheDocument();
  });
});
