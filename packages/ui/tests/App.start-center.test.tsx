// @vitest-environment happy-dom

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAppStore } from '@linkterm/ui/store/app-store';
import { installMockPreload, type MockPreloadAPI } from '../../../tests/fixtures/mock-preload-api.js';

const terminalMockState = vi.hoisted(() => ({
  propsBySession: new Map<
    string,
    {
      sessionId: string | null;
      onVisibleDeviceSequence?: (ack: { sessionId: string; sequence: number }) => void;
      onTranscriptDisplayUnavailable?: (reasonCode: string) => void;
      onTranscriptDisplayRecovered?: () => void;
    }
  >(),
}));

vi.mock('@linkterm/ui/components/TerminalView', () => ({
  TerminalView: ({
    sessionId,
    onVisibleDeviceSequence,
    onTranscriptDisplayUnavailable,
    onTranscriptDisplayRecovered,
  }: {
    sessionId: string | null;
    onVisibleDeviceSequence?: (ack: { sessionId: string; sequence: number }) => void;
    onTranscriptDisplayUnavailable?: (reasonCode: string) => void;
    onTranscriptDisplayRecovered?: () => void;
  }) => {
    if (sessionId !== null) {
      terminalMockState.propsBySession.set(sessionId, {
        sessionId,
        onVisibleDeviceSequence,
        onTranscriptDisplayUnavailable,
        onTranscriptDisplayRecovered,
      });
    }
    return (
      <div data-testid={`terminal-${sessionId ?? 'none'}`}>
        {sessionId}
        {sessionId !== null ? (
          <>
            <button
              type="button"
              data-testid={`terminal-visible-ack-${sessionId}`}
              onClick={() => onVisibleDeviceSequence?.({ sessionId, sequence: 1 })}
            >
              ack
            </button>
            <button
              type="button"
              data-testid={`terminal-display-unavailable-${sessionId}`}
              onClick={() =>
                onTranscriptDisplayUnavailable?.('firstSignal.display.subscribeFailed')
              }
            >
              display unavailable
            </button>
            <button
              type="button"
              data-testid={`terminal-display-recovered-${sessionId}`}
              onClick={() => onTranscriptDisplayRecovered?.()}
            >
              display recovered
            </button>
          </>
        ) : null}
      </div>
    );
  },
}));

vi.mock('@linkterm/ui/components/ConnectionDialog', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

const resetStore = (): void => {
  sessionStorage.clear();
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
    connectionDialogPrefill: null,
  });
};

describe('App Start Center integration', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    resetStore();
    terminalMockState.propsBySession.clear();
    mock = installMockPreload();
    mock.setReadinessSnapshot(mock.readinessSnapshot(1, 'action-required'));
  });

  it('replaces the no-session canvas with Start Center without first-signal states', async () => {
    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Start Center' })).toBeInTheDocument();
    expect(screen.queryByText('No active session')).toBeNull();
    expect(screen.queryByText(/first signal|waiting for device text|completion ack/i)).toBeNull();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
  });

  it('keeps Activity Center closed on Start Center until the observation capsule is opened', async () => {
    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'AI: Idle' }));
    expect(await screen.findByRole('dialog', { name: 'Activity Center' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Activity Center' }));
    expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull();
  });

  it('keeps system Agent settings in the header and removes advanced devices from home', async () => {
    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(screen.queryByTestId('advanced-devices')).toBeNull();
    expect(screen.queryByText('Advanced devices')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'MCP / Agent integrations' }),
    ).toBeInTheDocument();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
  });

  it('opens the shared connection dialog from the serial-only workspace choice', async () => {
    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(screen.queryByLabelText('Manual serial port')).toBeNull();
    expect(screen.queryByText('COM10')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'New device workspace' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Serial-only connection' }));

    expect(useAppStore.getState().dialogOpen).toBe(true);
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
  });

  it('loads saved connections on Start Center and opens one through the existing API', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_com6',
          label: 'FNA board',
          type: 'serial',
          config: { type: 'serial', port: 'COM6', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    mock.spies.connections.open.mockResolvedValueOnce({
      success: true,
      data: {
        profile: {
          id: 'conn_com6',
          label: 'FNA board',
          type: 'serial',
          config: { type: 'serial', port: 'COM6', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        sessionId: 'sess_saved_com6',
        state: 'open',
      },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Open workspace' }));

    await waitFor(() =>
      expect(mock.spies.connections.open).toHaveBeenCalledWith({ profileId: 'conn_com6' }),
    );
    expect(useAppStore.getState().sessions.get('sess_saved_com6')).toMatchObject({
      id: 'sess_saved_com6',
      label: 'FNA board',
      connectionType: 'serial',
      state: 'open',
    });
  });

  it('keeps a failed serial-only workspace visible with an actionable repair route', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_missing_com6',
          label: 'Disconnected FNA board',
          type: 'serial',
          config: { type: 'serial', port: 'COM6', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    mock.spies.connections.open.mockResolvedValueOnce({
      success: false,
      error: { code: 'SERIAL_PORT_NOT_FOUND', message: 'COM6 is no longer available' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Open workspace' }));

    expect(await within(saved).findByRole('alert')).toHaveTextContent(
      'COM6 is no longer available',
    );
    expect(within(saved).getByText('Disconnected FNA board')).toBeInTheDocument();
    expect(useAppStore.getState().sessions).toHaveLength(0);

    fireEvent.click(within(saved).getByRole('button', { name: 'Repair configuration' }));
    expect(useAppStore.getState().dialogOpen).toBe(true);
    expect(useAppStore.getState().connectionDialogPrefill).toEqual({
      type: 'serial',
      label: 'Disconnected FNA board',
      connectionProfileId: 'conn_missing_com6',
      connectionProfileUpdatedAt: new Date(0).toISOString(),
      serialPort: 'COM6',
      baudRate: '115200',
      serialMode: 'terminal',
    });
  });

  it('keeps a missing full workspace visible and does not create an observation session', async () => {
    const record = {
      id: 'ctrl_missing_root',
      label: 'Moved FNA workspace',
      root: 'C:/old-location',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM10', baudRate: 115200, mode: 'terminal' as const },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'CONTROL_PROFILE_NOT_FOUND',
        message: 'Control profile not found at C:/old-location',
      },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Open workspace' }));

    expect(await within(saved).findByRole('alert')).toHaveTextContent(
      'Control profile not found at C:/old-location',
    );
    expect(within(saved).getByText('Moved FNA workspace')).toBeInTheDocument();
    expect(within(saved).getByRole('button', { name: 'Repair configuration' })).toBeEnabled();
    expect(useAppStore.getState().sessions).toHaveLength(0);
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();

    fireEvent.click(within(saved).getByRole('button', { name: 'Repair configuration' }));
    expect(await screen.findByLabelText('Workspace root')).toHaveValue('C:/old-location');
    expect(screen.getByLabelText('Baud rate')).toHaveValue('115200');
  });

  it('reports an unexpected saved-workspace IPC rejection on the affected card', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_ipc_failure',
          label: 'FNA IPC failure',
          type: 'serial',
          config: { type: 'serial', port: 'COM10', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    mock.spies.connections.open.mockRejectedValueOnce(new Error('Connection IPC unavailable'));

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Open workspace' }));

    expect(await within(saved).findByRole('alert')).toHaveTextContent('Connection IPC unavailable');
    expect(within(saved).getByText('FNA IPC failure')).toBeInTheDocument();
    expect(useAppStore.getState().sessions).toHaveLength(0);
  });

  it('deletes a saved serial-only workspace without closing an open session', async () => {
    const profile = {
      id: 'conn_com6',
      label: 'FNA board',
      type: 'serial' as const,
      config: {
        type: 'serial' as const,
        port: 'COM6',
        baudRate: 115200,
        mode: 'terminal' as const,
      },
      hasCredential: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.connections.list.mockResolvedValueOnce({ success: true, data: [profile] });
    const confirmDelete = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmDelete);

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    expect(within(saved).getByText('FNA board')).toBeInTheDocument();
    fireEvent.click(within(saved).getByRole('button', { name: 'Delete workspace' }));

    await waitFor(() =>
      expect(mock.spies.connections.delete).toHaveBeenCalledWith({ profileId: 'conn_com6' }),
    );
    await waitFor(() => expect(within(saved).queryByText('FNA board')).toBeNull());
    expect(mock.spies.controlProfile.deleteRecord).not.toHaveBeenCalled();
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
    expect(confirmDelete).toHaveBeenCalledOnce();
  });

  it('deletes a saved full workspace through the control-profile API', async () => {
    const record = {
      id: 'ctrl_fna',
      label: 'FNA complete workspace',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: {
          enabled: true,
          target: 'STM32H743II',
          interface: 'swd' as const,
          speedKHz: 'auto' as const,
        },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    const confirmDelete = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmDelete);

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Delete workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.deleteRecord).toHaveBeenCalledWith({ recordId: 'ctrl_fna' }),
    );
    await waitFor(() => expect(within(saved).queryByText('FNA complete workspace')).toBeNull());
    expect(mock.spies.connections.delete).not.toHaveBeenCalled();
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
  });

  it('keeps a saved workspace when deletion confirmation is cancelled', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_com8',
          label: 'Keep this board',
          type: 'serial',
          config: { type: 'serial', port: 'COM8', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    const confirmDelete = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDelete);

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Delete workspace' }));

    expect(mock.spies.connections.delete).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.deleteRecord).not.toHaveBeenCalled();
    expect(within(saved).getByText('Keep this board')).toBeInTheDocument();
  });

  it('keeps the workspace visible and reports a storage error when deletion fails', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_locked',
          label: 'Locked board',
          type: 'serial',
          config: { type: 'serial', port: 'COM9', baudRate: 115200, mode: 'terminal' },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    mock.spies.connections.delete.mockResolvedValueOnce({
      success: false,
      error: { code: 'CONNECTION_DELETE_FAILED', message: 'saved workspace is locked' },
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved workspaces' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Delete workspace' }));

    expect(await within(saved).findByRole('alert')).toHaveTextContent('saved workspace is locked');
    expect(within(saved).getByText('Locked board')).toBeInTheDocument();
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
  });

  it('keeps the terminal as the primary canvas when sessions exist', async () => {
    useAppStore.getState().addSession({
      id: 'sess_existing',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(await screen.findByTestId('terminal-sess_existing')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Start Center' })).toBeNull();
  });
});
