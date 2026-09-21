// @vitest-environment happy-dom
/**
 * App 根组件单测。
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAppStore } from '@linkterm/ui/store/app-store';
import { installMockPreload, type MockPreloadAPI } from '../../../tests/fixtures/mock-preload-api.js';
import { activitySnapshot, operationEvent } from './activity/activity-fixtures.js';

vi.mock('@linkterm/ui/components/TerminalView', () => ({
  TerminalView: ({
    sessionId,
    focusRequestToken,
  }: {
    sessionId: string | null;
    focusRequestToken?: number;
  }) => (
    <div
      data-testid={`terminal-${sessionId ?? 'none'}`}
      data-focus-request-token={focusRequestToken ?? 0}
    >
      {sessionId}
    </div>
  ),
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

const openControlProfilePanel = async (): Promise<void> => {
  const direct = screen.queryByTestId('control-profile-open');
  if (direct !== null) {
    fireEvent.click(direct);
    return;
  }
  fireEvent.click(await screen.findByRole('button', { name: 'New device workspace' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Full device workspace' }));
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

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(screen.getByTestId('terminal-sess_1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-sess_2')).toBeInTheDocument();
  });

  it('shows the AI status capsule from the activity bridge and opens a non-modal drawer', async () => {
    mock.spies.activity.subscribe.mockResolvedValueOnce({
      success: true,
      data: activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_serial',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_serial',
          targetLabel: 'serial COM3',
        }),
      ]),
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const capsule = await screen.findByRole('button', { name: 'AI: Running' });
    expect(mock.spies.activity.subscribe).toHaveBeenCalledOnce();

    capsule.focus();
    fireEvent.click(capsule);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).getByText('open_session')).toBeInTheDocument();
    expect(within(drawer).getByText('serial COM3')).toBeInTheDocument();
    expect(drawer).not.toHaveAttribute('aria-modal', 'true');
    expect(capsule).toHaveFocus();
    expect(mock.spies.session.create).not.toHaveBeenCalled();

    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull());
    expect(capsule).toHaveFocus();
  });

  it('hydrates activity from a prior renderer cursor on reload', async () => {
    sessionStorage.setItem(
      'linkterm:activity-cursor',
      JSON.stringify({ runtimeId: 'runtime_prior', sequence: 7 }),
    );

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await waitFor(() =>
      expect(mock.spies.activity.subscribe).toHaveBeenCalledWith({
        cursor: { runtimeId: 'runtime_prior', sequence: 7 },
      }),
    );
  });

  it('uses the mock activity subscribe race helper without exposing ipcRenderer', async () => {
    const pending = mock.deferActivitySubscribe();

    const { App } = await import('@linkterm/ui/App');
    render(<App />);
    mock.emitActivityEvent(
      operationEvent({
        sequence: 2,
        operationId: 'operation_after_mock_cut',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );
    pending.resolve({
      success: true,
      data: activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_mock_snapshot',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
      ]),
    });

    expect(await screen.findByRole('button', { name: 'AI: Running' })).toBeInTheDocument();
    expect('ipcRenderer' in mock.api).toBe(false);
  });

  it('opens the Activity Center from a session origin entry filtered to that session', async () => {
    const { addSession } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'COM1', connectionType: 'serial', state: 'open' });
    mock.spies.activity.subscribe.mockResolvedValueOnce({
      success: true,
      data: activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_sess_1',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_1',
          targetLabel: 'COM1',
        }),
        operationEvent({
          sequence: 2,
          operationId: 'operation_sess_2',
          phase: 'failed',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'session',
          targetId: 'sess_2',
          targetLabel: 'COM2',
        }),
        operationEvent({
          sequence: 3,
          operationId: 'operation_job_collision',
          phase: 'failed',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'job',
          targetId: 'sess_1',
          targetLabel: 'job with colliding id',
        }),
      ]),
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const originEntry = await screen.findByRole('button', {
      name: 'Open activity for COM1; AI idle, Human idle, System idle',
    });
    originEntry.focus();
    fireEvent.click(originEntry);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).getByText('open_session')).toBeInTheDocument();
    expect(within(drawer).getByText('COM1')).toBeInTheDocument();
    expect(within(drawer).queryByText('run_control_workflow')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('COM2')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('job with colliding id')).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close Activity Center' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull());
    expect(originEntry).toHaveFocus();
  });

  it('keeps the Activity Center open when the terminal is clicked so both workspaces remain usable', async () => {
    const { addSession } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'COM1', connectionType: 'serial', state: 'open' });
    mock.spies.activity.subscribe.mockResolvedValueOnce({
      success: true,
      data: activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_sess_1',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_1',
          targetLabel: 'COM1',
        }),
      ]),
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    const originEntry = await screen.findByRole('button', {
      name: 'Open activity for COM1; AI idle, Human idle, System idle',
    });
    fireEvent.click(originEntry);
    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('terminal-sess_1'));

    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toBeInTheDocument();
  });

  it('keeps the Activity Center observation-only in the app shell', async () => {
    const { addSession } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'COM1', connectionType: 'serial', state: 'open' });
    mock.spies.activity.subscribe.mockResolvedValueOnce({
      success: true,
      data: activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_sess_1',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_1',
          targetLabel: 'COM1',
        }),
      ]),
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'AI: Running' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Activity Center' }));
    expect(drawer.queryByRole('button', { name: /Go to session/i })).not.toBeInTheDocument();
    expect(drawer.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    expect(useAppStore.getState().activeSessionId).toBe('sess_1');
    expect(mock.spies.session.create).not.toHaveBeenCalled();
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_serial_profile', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(within(await screen.findByRole('dialog')).getByText('repo - Serial')).toBeInTheDocument();
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
    expect(screen.getByTestId('control-profile-progress')).toHaveClass(
      'motion-safe:transition-[width]',
    );
    expect(screen.getByTestId('terminal-sess_serial_profile')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    useAppStore.getState().updateSessionState('sess_serial_profile', 'errored');

    await waitFor(() =>
      expect(screen.getByTestId('control-profile-status')).toHaveTextContent('errored'),
    );
  });

  it('binds a saved full workspace to an AI-opened session id without adding another tab', async () => {
    const record = {
      id: 'ctrl_ai_shared',
      label: 'repo - Shared COM7',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.session.list.mockResolvedValue({
      success: true,
      data: {
        sessions: [
          {
            sessionId: 'sess_ai_shared',
            state: 'open',
            connectionType: 'serial',
            label: 'AI COM7',
            createdBy: 'ai',
            serial: { port: 'COM7', baudRate: 115200, mode: 'terminal' },
          },
        ],
      },
    });
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_ai_shared', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);
    await waitFor(() => expect(useAppStore.getState().activeSessionId).toBe('sess_ai_shared'));

    fireEvent.click(await screen.findByTestId('control-profile-sidebar-item-ctrl_ai_shared'));

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledOnce());
    expect(useAppStore.getState().sessions.size).toBe(1);
    expect(useAppStore.getState().activeSessionId).toBe('sess_ai_shared');
    expect(screen.getAllByTestId('terminal-sess_ai_shared')).toHaveLength(1);
  });

  it('keeps the control-profile sidebar out of the no-session Start Center', async () => {
    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Start Center' })).toBeVisible();
    expect(screen.queryByTestId('control-profile-sidebar')).toBeNull();
    expect(screen.queryByText('repo - Sidebar Serial')).toBeNull();
  });

  it('switches between already opened control profiles from the side bar without reopening them', async () => {
    const serialRecord = {
      id: 'ctrl_switch_serial',
      label: 'repo - Switch Serial',
      root: 'C:/repo/serial',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' as const },
        flash: { binary: 'build/serial.bin', baseAddress: '0x08000000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(1).toISOString(),
    };
    const rttRecord = {
      id: 'ctrl_switch_rtt',
      label: 'repo - Switch RTT',
      root: 'C:/repo/rtt',
      source: 'ai' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        rtt: { enabled: true, channels: [1], controlBlockAddress: '0x24005310' },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' as const },
        flash: { binary: 'build/rtt.elf', baseAddress: '0x08008000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(2).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValue({
      success: true,
      data: [rttRecord, serialRecord],
    });
    mock.spies.controlProfile.openRecord
      .mockResolvedValueOnce({
        success: true,
        data: { path: 'C:/repo/serial/.linkterm/control-profile.json', record: serialRecord },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { path: 'C:/repo/rtt/.linkterm/control-profile.json', record: rttRecord },
      });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_switch_serial', state: 'open' },
    });
    mock.spies.rttLog.open.mockResolvedValueOnce({
      success: true,
      data: {
        sessionId: 'sess_switch_rtt',
        state: 'open',
        reused: false,
        probeId: 'probe-1',
        channelIndex: 1,
      },
    });

    useAppStore.getState().addSession({
      id: 'sess_existing',
      label: 'Existing terminal',
      connectionType: 'serial',
      state: 'open',
    });
    useAppStore.getState().setActive('sess_existing');

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    expect(await screen.findByTestId('control-profile-sidebar-item-ctrl_switch_serial')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('control-profile-sidebar-item-ctrl_switch_serial'));
    expect(await screen.findByTestId('terminal-sess_switch_serial')).toBeVisible();

    fireEvent.click(screen.getByTestId('control-profile-sidebar-item-ctrl_switch_rtt'));
    expect(await screen.findByTestId('terminal-sess_switch_rtt')).toBeVisible();

    fireEvent.click(screen.getByTestId('control-profile-sidebar-item-ctrl_switch_serial'));

    await waitFor(() =>
      expect(screen.getByTestId('terminal-sess_switch_serial')).toBeVisible(),
    );
    expect(mock.spies.controlProfile.openRecord).toHaveBeenCalledTimes(2);
    expect(mock.spies.session.create).toHaveBeenCalledTimes(1);
    expect(mock.spies.rttLog.open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('repo - Switch Serial');
  });

  it.each([
    { verified: true, expectedCompletion: 'Download verified' },
    { verified: false, expectedCompletion: 'Download command completed · not verified' },
  ])('shows evidence-backed download progress ($expectedCompletion)', async ({
    verified,
    expectedCompletion,
  }) => {
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
    const runningStep = {
      id: 'flash_download',
      status: 'running' as const,
      durationMs: 0,
      evidence: {
        progress: {
          phase: 'erasing',
          message: 'Erasing sectors',
          bytesTotal: 4096,
        },
      },
    };
    const finalResult = {
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      steps: [
        {
          id: 'flash_download',
          status: 'passed' as const,
          durationMs: 1250,
          evidence: {
            progress: {
              phase: 'completed',
              message: 'Flash download completed',
              percent: 100,
              bytesWritten: 4096,
              bytesTotal: 4096,
            },
          },
        },
        {
          id: 'verify',
          status: 'passed' as const,
          durationMs: 300,
          evidence: { bytes: 4096, checksum: '0x1234' },
        },
      ],
      summary: {
        serialOpened: true,
        probeConnected: true,
        gdbServerStarted: false,
        flashed: true,
        verified,
        reset: true,
        serialObserved: true,
        rttObserved: false,
        debugCaptured: false,
      },
      nextActions: [],
    };
    const runningJob = {
      jobId: 'download-job-1',
      state: 'running' as const,
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      createdAt: 1,
      startedAt: 1,
      updatedAt: 2,
      currentStepId: 'flash_download',
      currentStep: runningStep,
      cancelRequested: false,
      summary: finalResult.summary,
      workflow: {
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        steps: [runningStep],
        summary: finalResult.summary,
        nextActions: [],
      },
    };
    const succeededJob = {
      ...runningJob,
      state: 'succeeded' as const,
      completedAt: 3,
      updatedAt: 3,
      currentStep: finalResult.steps[1],
      currentStepId: 'verify',
      workflow: finalResult,
    };
    let resolveNextStatus!: (value: { success: true; data: typeof succeededJob }) => void;
    const nextStatus = new Promise<{ success: true; data: typeof succeededJob }>((resolve) => {
      resolveNextStatus = resolve;
    });
    const startDownload = vi.fn(async () => ({ success: true as const, data: runningJob }));
    const getDownloadStatus = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: runningJob })
      .mockReturnValue(nextStatus);
    const readDownload = vi.fn(async () => ({ success: true as const, data: succeededJob }));
    Object.assign(mock.api.controlProfile as Record<string, unknown>, {
      startDownload,
      getDownloadStatus,
      readDownload,
    });
    Object.assign(mock.spies.controlProfile as Record<string, unknown>, {
      startDownload,
      getDownloadStatus,
      readDownload,
    });
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_download_profile', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(within(await screen.findByRole('dialog')).getByText('repo - Download')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    expect(screen.getByTestId('control-profile-progress')).toHaveStyle({ width: '0%' });
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(startDownload).toHaveBeenCalledWith({ root: 'C:/repo' }),
    );
    await waitFor(() =>
      expect(getDownloadStatus).toHaveBeenCalledWith({ jobId: 'download-job-1' }),
    );
    expect(screen.getByTestId('control-profile-status-bar')).toHaveAttribute(
      'data-phase',
      'running',
    );
    expect(statusPanel).toHaveTextContent('Downloading...');
    expect(statusPanel).toHaveTextContent('Erasing sectors');
    expect(statusPanel).not.toHaveTextContent(/\d+%/u);
    expect(screen.getByTestId('control-profile-progress')).toHaveStyle({ width: '0%' });
    expect(screen.queryByTestId('control-profile-download-result')).not.toBeInTheDocument();

    resolveNextStatus({ success: true, data: succeededJob });

    await waitFor(() =>
      expect(screen.getByTestId('control-profile-status-bar')).toHaveAttribute(
        'data-phase',
        'succeeded',
      ),
    );
    expect(statusPanel).toHaveTextContent(expectedCompletion);
    expect(screen.queryByTestId('control-profile-download-result')).not.toBeInTheDocument();
    expect(statusPanel).not.toHaveTextContent('flash_download');
    expect(statusPanel).not.toHaveTextContent('passed');
    expect(statusPanel).not.toHaveTextContent('1250 ms');
    expect(statusPanel).not.toHaveTextContent('4096');
    expect(statusPanel).not.toHaveTextContent('probeConnected');
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_legacy_serial_profile', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Legacy Serial'),
    ).toBeInTheDocument();
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
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

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Close With Session'),
    ).toBeInTheDocument();
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

  it('disconnects the opened serial profile from the status area and can open it again', async () => {
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create
      .mockResolvedValueOnce({
        success: true,
        data: { sessionId: 'sess_disconnect_profile', state: 'open' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sessionId: 'sess_reconnect_profile', state: 'open' },
      });
    mock.spies.session.destroy.mockResolvedValueOnce({
      success: true,
      data: { destroyed: true },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Disconnect'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Disconnect serial' }));

    await waitFor(() =>
      expect(mock.spies.session.destroy).toHaveBeenCalledWith({
        sessionId: 'sess_disconnect_profile',
      }),
    );
    expect(screen.queryByTestId('terminal-sess_disconnect_profile')).toBeNull();
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('repo - Disconnect');

    const disconnectedStatusPanel = screen.getByTestId('control-profile-status');
    const openSerialButton = within(disconnectedStatusPanel).getByRole('button', {
      name: 'Open serial',
    });
    expect(openSerialButton).toBeEnabled();
    fireEvent.click(openSerialButton);

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('terminal-sess_reconnect_profile')).toBeVisible();
  });

  it('connects and disconnects the chip separately from the opened session', async () => {
    const record = {
      id: 'ctrl_chip_lifecycle',
      label: 'repo - Chip Lifecycle',
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
    const connectChip = vi.fn(async () => ({
      success: true as const,
      data: {
        probe: {
          probeId: '11111111-1111-4111-8111-111111111111',
          target: 'STM32H743II',
          connected: true,
        },
      },
    }));
    const disconnectChip = vi.fn(async () => ({
      success: true as const,
      data: { probeId: '11111111-1111-4111-8111-111111111111', disconnected: true },
    }));
    Object.assign(mock.api.controlProfile as Record<string, unknown>, {
      connectChip,
      disconnectChip,
    });
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_chip_lifecycle', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Chip Lifecycle'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Connect chip' }));

    await waitFor(() => expect(connectChip).toHaveBeenCalledWith({ root: 'C:/repo' }));
    expect(mock.spies.session.create).toHaveBeenCalledTimes(1);
    expect(statusPanel).toHaveTextContent('Chip connected');
    expect(statusPanel).toHaveTextContent('11111111-1111-4111-8111-111111111111');

    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Disconnect chip' }));

    await waitFor(() =>
      expect(disconnectChip).toHaveBeenCalledWith({
        probeId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
    expect(statusPanel).toHaveTextContent('Chip disconnected');
  });

  it('keeps the chip disconnected when the backend lacks positive target evidence', async () => {
    const record = {
      id: 'ctrl_chip_target_missing',
      label: 'repo - Missing Target',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: {
          enabled: true,
          target: 'STM32H743II',
          interface: 'swd' as const,
          speedKHz: 4000,
        },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const connectChip = vi.fn(async () => ({
      success: false as const,
      error: {
        code: 'JLINK_OPERATION_FAILED',
        message: 'No positive target-access evidence; check target power and SWD wiring',
      },
    }));
    Object.assign(mock.api.controlProfile as Record<string, unknown>, { connectChip });
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_chip_target_missing', state: 'open' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Missing Target'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Connect chip' }));

    await waitFor(() => expect(connectChip).toHaveBeenCalledWith({ root: 'C:/repo' }));
    expect(statusPanel).toHaveTextContent('No positive target-access evidence');
    expect(statusPanel).not.toHaveTextContent('Chip connected');
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
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

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(within(await screen.findByRole('dialog')).getByText('repo - RTT')).toBeInTheDocument();
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'SERIAL_OPEN_FAILED', message: 'COM404 is unavailable' },
    });

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Missing Serial'),
    ).toBeInTheDocument();
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
    mock.spies.controlProfile.listRecords.mockResolvedValue({ success: true, data: [record] });
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

    const { App } = await import('@linkterm/ui/App');
    render(<App />);

    await openControlProfilePanel();
    expect(
      within(await screen.findByRole('dialog')).getByText('repo - Retry Serial'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    const statusPanel = await screen.findByTestId('control-profile-status');
    expect(statusPanel).toHaveTextContent('first open failed');
    fireEvent.click(within(statusPanel).getByRole('button', { name: 'Open serial' }));

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('control-profile-status')).toHaveTextContent('open');
    expect(screen.getByTestId('control-profile-status')).not.toHaveTextContent('first open failed');
    expect(screen.getByTestId('terminal-sess_retry_profile')).toBeVisible();
  });
});
