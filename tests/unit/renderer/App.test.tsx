// @vitest-environment happy-dom
/**
 * App 根组件单测。
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAppStore } from '../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../fixtures/mock-preload-api.js';

vi.mock('../../../src/renderer/components/TerminalView.js', () => ({
  TerminalView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-testid={`terminal-${sessionId ?? 'none'}`}>{sessionId}</div>
  ),
}));

vi.mock('../../../src/renderer/components/ConnectionDialog.js', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

const resetStore = (): void => {
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

describe('App', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
    mock.spies.serial.listPorts.mockResolvedValue({
      success: true,
      data: [{ path: 'COM7', friendlyName: 'USB Serial' }],
    });
  });

  it('keeps one terminal instance mounted per session so switching tabs preserves output', async () => {
    const { addSession, setActive } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'COM1', connectionType: 'serial', state: 'open' });
    addSession({ id: 'sess_2', label: 'COM2', connectionType: 'serial', state: 'open' });
    setActive('sess_1');

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(screen.getByTestId('terminal-sess_1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-sess_2')).toBeInTheDocument();
  });

  it('opens a saved serial control profile and shows profile details with live status', async () => {
    const record = {
      id: 'ctrl_serial',
      label: 'repo - Serial',
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
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_serial_profile', state: 'open' },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Serial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    await waitFor(() =>
      expect(mock.spies.session.create).toHaveBeenCalledWith({
        config: {
          type: 'serial',
          port: 'COM7',
          baudRate: 115200,
          mode: 'terminal',
          label: 'repo - Serial',
        },
        label: 'repo - Serial',
      }),
    );

    expect(await screen.findByTestId('control-profile-status')).toHaveTextContent('repo - Serial');
    expect(screen.getByTestId('control-profile-status')).toHaveAttribute(
      'data-panel-position',
      'left',
    );
    expect(
      screen
        .getByTestId('control-profile-status')
        .compareDocumentPosition(screen.getByTestId('terminal-sess_serial_profile')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('C:/repo');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('COM7');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('115200');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('STM32H743II');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('build/app.bin');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('open');
    expect(screen.getByTestId('terminal-sess_serial_profile')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    useAppStore.getState().updateSessionState('sess_serial_profile', 'errored');

    await waitFor(() =>
      expect(screen.getByTestId('control-profile-status')).toHaveTextContent('errored'),
    );
  });

  it('runs download from the opened control profile status area and shows progress data', async () => {
    const record = {
      id: 'ctrl_serial_download',
      label: 'repo - Download',
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
    let resolveDownload!: (
      value: Awaited<ReturnType<typeof mock.api.controlProfile.runDownload>>,
    ) => void;
    const downloadPromise = new Promise<
      Awaited<ReturnType<typeof mock.api.controlProfile.runDownload>>
    >((resolve) => {
      resolveDownload = resolve;
    });
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_download_profile', state: 'open' },
    });
    mock.spies.controlProfile.runDownload.mockReturnValueOnce(downloadPromise);

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Download')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.runDownload).toHaveBeenCalledWith({ root: 'C:/repo' }),
    );
    expect(screen.getByTestId('control-profile-status-bar')).toHaveAttribute(
      'data-phase',
      'running',
    );
    expect(statusPanel).toHaveTextContent('Downloading...');

    resolveDownload({
      success: true,
      data: {
        mode: 'flash-observe',
        root: 'C:/repo',
        steps: [
          {
            id: 'flash_download',
            status: 'passed',
            durationMs: 1250,
            evidence: 'ConfigTargetSettings() start - ConfigTargetSettings() end',
          },
          {
            id: 'verify',
            status: 'passed',
            durationMs: 300,
            evidence: { bytes: 4096, checksum: '0x1234' },
          },
        ],
        summary: {
          serialOpened: true,
          probeConnected: true,
          gdbServerStarted: false,
          flashed: true,
          verified: true,
          reset: true,
          serialObserved: true,
          rttObserved: false,
          debugCaptured: false,
        },
        nextActions: [],
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('control-profile-status-bar')).toHaveAttribute(
        'data-phase',
        'succeeded',
      ),
    );
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent(
      'Download complete',
    );
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent(
      'flash_download',
    );
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent('passed');
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent('1250 ms');
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent(
      'ConfigTargetSettings() start',
    );
    expect(screen.getByTestId('control-profile-download-result')).toHaveTextContent('4096');
  });

  it('opens a saved serial control profile when serial mode is omitted', async () => {
    const record = {
      id: 'ctrl_serial_legacy',
      label: 'repo - Legacy Serial',
      root: 'C:/repo',
      source: 'ai' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200 },
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
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_legacy_serial_profile', state: 'open' },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Legacy Serial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    await waitFor(() =>
      expect(mock.spies.session.create).toHaveBeenCalledWith({
        config: {
          type: 'serial',
          port: 'COM7',
          baudRate: 115200,
          mode: 'terminal',
          label: 'repo - Legacy Serial',
        },
        label: 'repo - Legacy Serial',
      }),
    );
    expect(await screen.findByTestId('control-profile-status')).toHaveTextContent(
      'repo - Legacy Serial',
    );
    expect(screen.getByTestId('terminal-sess_legacy_serial_profile')).toBeVisible();
  });

  it('closes opened control profile details when its session is closed', async () => {
    const record = {
      id: 'ctrl_serial_close',
      label: 'repo - Close With Session',
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
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_close_profile', state: 'open' },
    });
    mock.spies.session.destroy.mockResolvedValueOnce({
      success: true,
      data: { destroyed: true },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Close With Session')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    expect(await screen.findByTestId('control-profile-status')).toHaveTextContent(
      'repo - Close With Session',
    );
    fireEvent.click(screen.getByTestId('tab-close-sess_close_profile'));

    await waitFor(() =>
      expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_close_profile' }),
    );
    await waitFor(() => expect(screen.queryByTestId('control-profile-status')).toBeNull());
  });

  it('disconnects the opened control profile from the status area and closes the status area', async () => {
    const record = {
      id: 'ctrl_serial_disconnect',
      label: 'repo - Disconnect',
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
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_disconnect_profile', state: 'open' },
    });
    mock.spies.session.destroy.mockResolvedValueOnce({
      success: true,
      data: { destroyed: true },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Disconnect')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(mock.spies.session.destroy).toHaveBeenCalledWith({
        sessionId: 'sess_disconnect_profile',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('control-profile-status')).toBeNull());
    expect(screen.queryByTestId('terminal-sess_disconnect_profile')).toBeNull();
  });

  it('opens a saved RTT control profile and shows resolved RTT details', async () => {
    const record = {
      id: 'ctrl_rtt',
      label: 'repo - RTT',
      root: 'C:/repo',
      source: 'ai' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        rtt: { enabled: true, channels: [1], controlBlockAddress: '0x24005310' },
        jlink: {
          enabled: true,
          target: 'STM32H743II',
          interface: 'swd' as const,
          speedKHz: 4000,
        },
        flash: { binary: 'build/app.elf', baseAddress: '0x08008000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.rttLog.open.mockResolvedValueOnce({
      success: true,
      data: {
        sessionId: 'sess_rtt_profile',
        state: 'open',
        reused: false,
        probeId: 'probe-1',
        channelIndex: 1,
      },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - RTT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    await waitFor(() =>
      expect(mock.spies.rttLog.open).toHaveBeenCalledWith({
        root: 'C:/repo',
        channelIndex: 1,
        label: 'repo - RTT',
      }),
    );
    expect(await screen.findByTestId('control-profile-status')).toHaveTextContent('repo - RTT');
    expect(screen.getByTestId('control-profile-status')).toHaveAttribute(
      'data-panel-position',
      'left',
    );
    expect(
      screen
        .getByTestId('control-profile-status')
        .compareDocumentPosition(screen.getByTestId('terminal-sess_rtt_profile')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('RTT ch1');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('0x24005310');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('build/app.elf');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('open');
    expect(screen.getByTestId('terminal-sess_rtt_profile')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps opened control profile details visible when observation auto-open fails', async () => {
    const record = {
      id: 'ctrl_serial_error',
      label: 'repo - Missing Serial',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM404', baudRate: 115200, mode: 'terminal' as const },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' as const },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'SERIAL_OPEN_FAILED', message: 'COM404 is unavailable' },
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Missing Serial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    expect(await screen.findByTestId('control-profile-status')).toHaveTextContent(
      'repo - Missing Serial',
    );
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('COM404');
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('COM404 is unavailable');
  });

  it('retries observation connection from the status area after auto-open fails', async () => {
    const record = {
      id: 'ctrl_serial_retry',
      label: 'repo - Retry Serial',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' as const },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'SERIAL_OPEN_FAILED', message: 'first open failed' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sessionId: 'sess_retry_profile', state: 'open' },
      });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(screen.getByTestId('control-profile-open'));
    expect(await screen.findByText('repo - Retry Serial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    expect(statusPanel).toHaveTextContent('first open failed');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('open');
    expect(screen.getByTestId('control-profile-status')).not.toHaveTextContent('first open failed');
    expect(screen.getByTestId('terminal-sess_retry_profile')).toBeVisible();
  });
});
