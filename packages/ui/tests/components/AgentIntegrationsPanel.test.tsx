// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentIntegrationsPanel } from '@linkterm/ui/components/AgentIntegrationsPanel';
import { installMockPreload, type MockPreloadAPI } from '../../../../tests/fixtures/mock-preload-api.js';

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
          platform: 'windows',
          locationLabel: 'Windows',
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
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('C:/Users/A/AppData/Roaming/Code/User/mcp.json')).toBeInTheDocument();
  });

  it('shows HTTP transport badges for HTTP MCP targets', async () => {
    mock.spies.agentIntegrations.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'codex',
          label: 'Codex',
          configPath: 'C:\\Users\\A\\.codex\\config.toml',
          configKind: 'codex-config-toml',
          platform: 'windows',
          locationLabel: 'Windows',
          transportLabel: 'HTTP',
          status: 'configured',
          configured: true,
          canInstall: false,
        },
      ],
    });

    render(<AgentIntegrationsPanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('HTTP')).toBeInTheDocument();
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

  it('removes selected integration and refreshes row status', async () => {
    mock.spies.agentIntegrations.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'codex',
          label: 'Codex',
          configPath: 'C:\\Users\\A\\.codex\\config.toml',
          configKind: 'codex-config-toml',
          platform: 'windows',
          locationLabel: 'Windows',
          transportLabel: 'HTTP',
          status: 'configured',
          configured: true,
          canInstall: false,
        },
      ],
    });
    mock.spies.agentIntegrations.uninstall.mockResolvedValueOnce({
      success: true,
      data: {
        backupPath: 'C:\\Users\\A\\.codex\\config.toml.bak-20260615-080911',
        status: {
          id: 'codex',
          label: 'Codex',
          configPath: 'C:\\Users\\A\\.codex\\config.toml',
          configKind: 'codex-config-toml',
          platform: 'windows',
          locationLabel: 'Windows',
          transportLabel: 'HTTP',
          status: 'not-configured',
          configured: false,
          canInstall: true,
          backupPath: 'C:\\Users\\A\\.codex\\config.toml.bak-20260615-080911',
        },
      },
    });

    render(<AgentIntegrationsPanel open onOpenChange={onOpenChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(mock.spies.agentIntegrations.uninstall).toHaveBeenCalledWith({ targetId: 'codex' }),
    );
    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText(/Backup:/)).toBeInTheDocument();
  });

  it('runs diagnostics for a selected integration', async () => {
    mock.spies.agentIntegrations.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'codex',
          label: 'Codex',
          configPath: 'C:\\Users\\A\\.codex\\config.toml',
          configKind: 'codex-config-toml',
          platform: 'windows',
          locationLabel: 'Windows',
          transportLabel: 'HTTP',
          status: 'needs-update',
          configured: false,
          canInstall: true,
        },
      ],
    });
    mock.spies.agentIntegrations.diagnose.mockResolvedValueOnce({
      success: true,
      data: {
        targetId: 'codex',
        label: 'Codex',
        transport: 'HTTP',
        checks: [
          { id: 'config', label: 'Codex MCP config', status: 'pass' },
          {
            id: 'token-env',
            label: 'LINKTERM_MCP_TOKEN',
            status: 'fail',
            message: 'LINKTERM_MCP_TOKEN is not visible to LinkTerm right now. Set it before starting LinkTerm and restart Codex so HTTP MCP authentication can inherit it.',
          },
        ],
      },
    });

    render(<AgentIntegrationsPanel open onOpenChange={onOpenChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Diagnose' }));

    await waitFor(() =>
      expect(mock.spies.agentIntegrations.diagnose).toHaveBeenCalledWith({ targetId: 'codex' }),
    );
    expect(await screen.findByText('LINKTERM_MCP_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('LINKTERM_MCP_TOKEN is not visible to LinkTerm right now. Set it before starting LinkTerm and restart Codex so HTTP MCP authentication can inherit it.')).toBeInTheDocument();
  });
});
