// @vitest-environment happy-dom

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAppStore } from '../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../fixtures/mock-preload-api.js';

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

vi.mock('../../../src/renderer/components/TerminalView.js', () => ({
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
              onClick={() => onTranscriptDisplayUnavailable?.('firstSignal.display.subscribeFailed')}
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

vi.mock('../../../src/renderer/components/ConnectionDialog.js', () => ({
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

const setSingleSerialCandidate = (mock: MockPreloadAPI, portLabel = 'COM10'): void => {
  const base = mock.readinessSnapshot(1, 'ready');
  mock.setReadinessSnapshot({
    ...base,
    deviceCandidates: [
      {
        id: `candidate_serial_${portLabel}`,
        kind: 'serial',
        label: `${portLabel} · USB Serial Device`,
        confidence: 'likely',
        requiresUserConfirmation: true,
        evidence: [
          {
            source: 'live-discovery',
            summaryCode: 'readiness.serial.detected',
            params: [{ key: 'port', value: portLabel }],
          },
        ],
        serial: {
          portLabel,
          baudRate: 115200,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
        },
      },
    ],
  });
};

describe('App Start Center integration', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    cleanup();
    resetStore();
    terminalMockState.propsBySession.clear();
    mock = installMockPreload();
    mock.setReadinessSnapshot(
      mock.readinessSnapshot(1, 'action-required'),
    );
  });

  it('replaces the no-session canvas with Start Center without first-signal states', async () => {
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Start Center' })).toBeInTheDocument();
    expect(screen.queryByText('No active session')).toBeNull();
    expect(screen.queryByText(/first signal|waiting for device text|completion ack/i)).toBeNull();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
  });

  it('keeps Activity Center closed on Start Center until the observation capsule is opened', async () => {
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'AI: Idle' }));
    expect(await screen.findByRole('dialog', { name: 'Activity Center' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Activity Center' }));
    expect(screen.queryByRole('dialog', { name: 'Activity Center' })).toBeNull();
  });

  it('keeps advanced tools separate from the single manual-open connection entry', async () => {
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    const advanced = await screen.findByTestId('advanced-devices');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(within(advanced).getByRole('button', { name: 'MCP / Agent integrations' })).toBeInTheDocument();
    expect(within(advanced).queryByRole('button', { name: 'Advanced connection…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manual open' }));

    expect(useAppStore.getState().dialogOpen).toBe(true);
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
  });

  it('opens the single connection dialog entry without a Start Center serial form', async () => {
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(screen.queryByLabelText('Manual serial port')).toBeNull();
    expect(screen.queryByText('COM10')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Manual open' }));

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

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    const saved = await screen.findByRole('region', { name: 'Saved connections' });
    fireEvent.click(within(saved).getByRole('button', { name: 'Open saved connection' }));

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

  it('reviews a detected candidate, then confirms a session and first-signal monitor without payload or hardware side effects', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'ready');
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [
        {
          id: 'candidate_serial_COM7',
          kind: 'serial',
          label: 'COM7 · USB Serial Device',
          confidence: 'likely',
          requiresUserConfirmation: true,
          evidence: [
            {
              source: 'live-discovery',
              summaryCode: 'readiness.serial.detected',
              params: [{ key: 'port', value: 'COM7' }],
            },
          ],
          serial: {
            portLabel: 'COM7',
            baudRate: 230400,
            dataBits: 7,
            stopBits: 2,
            parity: 'even',
          },
        },
      ],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));

    expect(await screen.findByRole('heading', { name: 'Review serial first signal' })).toBeVisible();
    expect(screen.getByText('COM7')).toBeInTheDocument();
    expect(screen.getByText('230400')).toBeInTheDocument();
    expect(useAppStore.getState().dialogOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));

    await waitFor(() =>
      expect(mock.spies.session.create).toHaveBeenCalledWith({
        config: {
          type: 'serial',
          port: 'COM7',
          baudRate: 230400,
          mode: 'terminal',
          dataBits: 7,
          stopBits: 2,
          parity: 'even',
        },
        label: 'COM7',
      }),
    );
    await waitFor(() => expect(mock.spies.firstSignal.start).toHaveBeenCalledOnce());
    expect(mock.spies.firstSignal.start.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: '1.0.0',
      sessionId: 'sess_test',
      ownsSession: true,
      baselineCursor: 0,
    });
    expect(mock.spies.session.write).not.toHaveBeenCalled();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
    expect(mock.spies.connections.saveAndOpen).not.toHaveBeenCalled();
    expect(mock.spies.connections.open).not.toHaveBeenCalled();
    expect(mock.spies.connections.delete).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.startDownload).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.connectChip).not.toHaveBeenCalled();

    mock.emitFirstSignalEvent(
      mock.firstSignalObservation({
        state: 'signal-detected',
        revision: 2,
        observedSequence: 1,
      }),
    );
    expect(await screen.findByText('Device text received; waiting for terminal display ack.')).toBeVisible();
    fireEvent.click(await screen.findByTestId('terminal-visible-ack-sess_test'));
    expect(await screen.findByText('First signal confirmed in the terminal.')).toBeVisible();
    expect(terminalMockState.propsBySession.get('sess_test')?.onVisibleDeviceSequence).toBeTypeOf(
      'function',
    );
    expect(mock.spies.connections.saveAndOpen).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.save).not.toHaveBeenCalled();
  });

  it('routes a detected J-Link candidate into a J-Link/RTT review instead of the serial first-signal flow', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'action-required');
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [
        {
          id: 'candidate_jlink_probe_a',
          kind: 'jlink',
          label: 'J-Link probe A · STM32H743II',
          confidence: 'likely',
          requiresUserConfirmation: true,
          evidence: [
            {
              source: 'jlink-backend',
              summaryCode: 'readiness.jlink.probeDetected',
              params: [{ key: 'target', value: 'STM32H743II' }],
            },
          ],
          jlink: {
            probeLabel: 'J-Link probe A',
            targetLabel: 'STM32H743II',
            interface: 'swd',
            speedKHz: 4000,
          },
        },
      ],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    const advanced = await screen.findByTestId('advanced-devices');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    fireEvent.click(await screen.findByRole('button', { name: 'Review this target' }));

    expect(await screen.findByRole('heading', { name: 'Review J-Link/RTT download' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Review serial first signal' })).toBeNull();
    expect(screen.getByText('J-Link probe A · STM32H743II')).toBeInTheDocument();
    expect(screen.getByText('Select a workspace profile and firmware before download.')).toBeInTheDocument();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.startDownload).not.toHaveBeenCalled();
    expect(mock.spies.controlProfile.connectChip).not.toHaveBeenCalled();
  });

  it('maps serial open failure into the guided first-signal error state', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'SERIAL_OPEN_FAILED', message: 'Port is busy' },
    });
    setSingleSerialCandidate(mock, 'COM12');
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm connect' }));

    expect(await screen.findByText('Port is busy')).toBeVisible();
    expect(mock.spies.firstSignal.start).not.toHaveBeenCalled();
    expect(mock.spies.session.write).not.toHaveBeenCalled();
  });

  it('applies the latest first-signal observation returned by subscribe hydration', async () => {
    mock.spies.firstSignal.subscribe.mockResolvedValueOnce({
      success: true,
      data: mock.firstSignalObservation({
        state: 'signal-detected',
        revision: 2,
        observedSequence: 1,
      }),
    });
    setSingleSerialCandidate(mock, 'COM17');
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm connect' }));

    await waitFor(() => expect(mock.spies.firstSignal.subscribe).toHaveBeenCalledOnce());
    expect(
      await screen.findByText('Device text received; waiting for terminal display ack.'),
    ).toBeVisible();

    fireEvent.click(await screen.findByTestId('terminal-display-unavailable-sess_test'));
    expect(
      await screen.findByText('Device text arrived, but the terminal display is not ready yet.'),
    ).toBeVisible();

    fireEvent.click(await screen.findByTestId('terminal-display-recovered-sess_test'));
    expect(
      await screen.findByText('Device text received; waiting for terminal display ack.'),
    ).toBeVisible();

    fireEvent.click(await screen.findByTestId('terminal-visible-ack-sess_test'));
    expect(await screen.findByText('First signal confirmed in the terminal.')).toBeVisible();
  });

  it('blocks confirm when the selected live candidate disappears before connect', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'ready');
    const candidate = {
      id: 'candidate_serial_COM7',
      kind: 'serial' as const,
      label: 'COM7 · USB Serial Device',
      confidence: 'likely' as const,
      requiresUserConfirmation: true,
      evidence: [{ source: 'live-discovery' as const, summaryCode: 'readiness.serial.detected' }],
      serial: {
        portLabel: 'COM7',
        baudRate: 115200,
        dataBits: 8 as const,
        stopBits: 1 as const,
        parity: 'none' as const,
      },
    };
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [candidate],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    expect(await screen.findByRole('heading', { name: 'Review serial first signal' })).toBeVisible();

    const disappeared = { ...candidateSnapshot, generation: 2, deviceCandidates: [] };
    mock.setReadinessSnapshot(disappeared);
    mock.emitReadinessEvent(disappeared);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));

    expect(
      await screen.findByText(
        'Selected serial candidate changed or disappeared. Refresh readiness or choose another port.',
      ),
    ).toBeVisible();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.firstSignal.start).not.toHaveBeenCalled();
  });

  it('blocks confirm when fresh readiness reports conflicting evidence for the same candidate', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'ready');
    const candidate = {
      id: 'candidate_serial_COM7',
      kind: 'serial' as const,
      label: 'COM7 · USB Serial Device',
      confidence: 'likely' as const,
      requiresUserConfirmation: true,
      evidence: [{ source: 'live-discovery' as const, summaryCode: 'readiness.serial.detected' }],
      serial: {
        portLabel: 'COM7',
        baudRate: 115200,
        dataBits: 8 as const,
        stopBits: 1 as const,
        parity: 'none' as const,
      },
    };
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [candidate],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    expect(await screen.findByRole('heading', { name: 'Review serial first signal' })).toBeVisible();

    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      generation: 2,
      deviceCandidates: [
        {
          ...candidate,
          confidence: 'unknown',
          evidence: [
            { source: 'live-discovery' as const, summaryCode: 'readiness.serial.detected' },
            { source: 'saved-record' as const, summaryCode: 'readiness.profile.conflict' },
          ],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));

    expect(
      await screen.findByText(
        'Selected serial candidate changed or disappeared. Refresh readiness or choose another port.',
      ),
    ).toBeVisible();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.firstSignal.start).not.toHaveBeenCalled();
  });

  it('blocks candidate confirm when fresh readiness revalidation fails', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'ready');
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [
        {
          id: 'candidate_serial_COM7',
          kind: 'serial',
          label: 'COM7 · USB Serial Device',
          confidence: 'likely',
          requiresUserConfirmation: true,
          evidence: [{ source: 'live-discovery', summaryCode: 'readiness.serial.detected' }],
          serial: {
            portLabel: 'COM7',
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          },
        },
      ],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    expect(await screen.findByRole('heading', { name: 'Review serial first signal' })).toBeVisible();

    mock.spies.readiness.get.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid readiness payload' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));

    expect(
      await screen.findByText(
        'Selected serial candidate changed or disappeared. Refresh readiness or choose another port.',
      ),
    ).toBeVisible();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.firstSignal.start).not.toHaveBeenCalled();
  });

  it('blocks confirm when live candidate evidence changes even if serial fields still match', async () => {
    const candidateSnapshot = mock.readinessSnapshot(1, 'ready');
    const candidate = {
      id: 'candidate_serial_COM7',
      kind: 'serial' as const,
      label: 'COM7 · USB Serial Device',
      confidence: 'likely' as const,
      requiresUserConfirmation: true,
      evidence: [
        {
          source: 'live-discovery' as const,
          summaryCode: 'readiness.serial.detected',
          params: [{ key: 'port', value: 'COM7' }],
        },
      ],
      serial: {
        portLabel: 'COM7',
        baudRate: 115200,
        dataBits: 8 as const,
        stopBits: 1 as const,
        parity: 'none' as const,
      },
    };
    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      deviceCandidates: [candidate],
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    expect(await screen.findByRole('heading', { name: 'Review serial first signal' })).toBeVisible();

    mock.setReadinessSnapshot({
      ...candidateSnapshot,
      generation: 2,
      deviceCandidates: [
        {
          ...candidate,
          confidence: 'unknown',
          evidence: [
            {
              source: 'live-discovery',
              summaryCode: 'readiness.serial.detected_changed',
              params: [{ key: 'port', value: 'COM7' }],
            },
          ],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));

    expect(
      await screen.findByText(
        'Selected serial candidate changed or disappeared. Refresh readiness or choose another port.',
      ),
    ).toBeVisible();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.firstSignal.start).not.toHaveBeenCalled();
  });

  it('cleans up owned first-signal recovery without closing reused sessions', async () => {
    setSingleSerialCandidate(mock, 'COM15');
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm connect' }));
    await waitFor(() => expect(mock.spies.firstSignal.start).toHaveBeenCalledOnce());

    mock.emitFirstSignalEvent(mock.firstSignalObservation({ state: 'silent', revision: 2 }));
    expect(
      await screen.findByText('No device text yet. The monitor is still listening.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect and edit' }));

    await waitFor(() =>
      expect(mock.spies.firstSignal.stop).toHaveBeenCalledWith({
        attemptId: 'attempt_1',
        reason: 'disconnect-and-edit',
      }),
    );
    expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_test' });
    await waitFor(() => expect(useAppStore.getState().sessions.has('sess_test')).toBe(false));
    expect(await screen.findByRole('button', { name: 'Confirm connect' })).toBeVisible();

    mock.setFirstSignalObservation(
      mock.firstSignalObservation({
        state: 'waiting',
        revision: 3,
        ownsSession: false,
      }),
    );
    mock.spies.session.destroy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));
    await waitFor(() => expect(mock.spies.firstSignal.start).toHaveBeenCalledTimes(2));
    mock.emitFirstSignalEvent(
      mock.firstSignalObservation({
        state: 'silent',
        revision: 4,
        ownsSession: false,
      }),
    );
    expect(await screen.findByRole('button', { name: 'Back to session' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Disconnect and edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to session' }));

    await waitFor(() =>
      expect(mock.spies.firstSignal.stop).toHaveBeenCalledWith({
        attemptId: 'attempt_1',
        reason: 'back-to-session',
      }),
    );
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('terminal-sess_test')).toBeVisible();
  });

  it('supports keep-waiting, retry, and disconnect recovery actions without serial writes', async () => {
    setSingleSerialCandidate(mock, 'COM16');
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm connect' }));
    await waitFor(() => expect(mock.spies.firstSignal.start).toHaveBeenCalledOnce());

    mock.emitFirstSignalEvent(mock.firstSignalObservation({ state: 'silent', revision: 2 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep waiting' }));
    expect(await screen.findByText('Waiting for non-empty device text.')).toBeVisible();
    expect(mock.spies.firstSignal.stop).not.toHaveBeenCalled();
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();

    mock.emitFirstSignalEvent(mock.firstSignalObservation({ state: 'silent', revision: 3 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(mock.spies.firstSignal.stop).toHaveBeenCalledWith({
        attemptId: 'attempt_1',
        reason: 'retry',
      }),
    );
    await waitFor(() =>
      expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_test' }),
    );
    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(2));
    const retryStopOrder = mock.spies.firstSignal.stop.mock.invocationCallOrder.at(-1);
    const retryDestroyOrder = mock.spies.session.destroy.mock.invocationCallOrder.at(-1);
    const retryCreateOrder = mock.spies.session.create.mock.invocationCallOrder.at(1);
    expect(retryStopOrder).toBeLessThan(retryDestroyOrder ?? 0);
    expect(retryDestroyOrder).toBeLessThan(retryCreateOrder ?? 0);
    mock.spies.session.destroy.mockClear();

    mock.emitFirstSignalEvent(mock.firstSignalObservation({ state: 'silent', revision: 4 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(mock.spies.firstSignal.stop).toHaveBeenCalledWith({
        attemptId: 'attempt_1',
        reason: 'user',
      }),
    );
    expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_test' });
    expect(mock.spies.session.write).not.toHaveBeenCalled();
  });

  it('routes Start Center refresh through hydration diagnostics instead of a raw preload call', async () => {
    mock.spies.readiness.refresh.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid readiness payload' },
    });
    mock.spies.readiness.get.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid readiness payload' },
    });
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByText('Advanced devices'));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh readiness' }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Diagnostics' })).toHaveTextContent(
        'Refresh failed',
      ),
    );
    expect(mock.spies.readiness.refresh).toHaveBeenCalled();
  });

  it('keeps the terminal as the primary canvas when sessions exist', async () => {
    useAppStore.getState().addSession({
      id: 'sess_existing',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(await screen.findByTestId('terminal-sess_existing')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Start Center' })).toBeNull();
  });
});
