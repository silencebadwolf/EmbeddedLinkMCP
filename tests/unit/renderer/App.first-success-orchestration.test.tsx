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

import type { DeviceCandidate } from '../../../src/shared/readiness-contract.js';
import type { RuntimeReadinessViewState } from '../../../src/renderer/features/readiness/readiness-reducer.js';

vi.mock('../../../src/renderer/features/readiness/StartCenter.js', () => ({
  StartCenter: ({
    state,
    onOpenFirstSuccessGuide,
    onUseCandidate,
    onRefresh,
    onAdvancedDevicesOpenChange,
  }: {
    state: RuntimeReadinessViewState;
    onOpenFirstSuccessGuide?: () => void;
    onUseCandidate: (candidate: DeviceCandidate) => void;
    onRefresh?: () => void;
    onAdvancedDevicesOpenChange?: (open: boolean) => void;
  }) => {
    const candidate = state.snapshot?.deviceCandidates[0];
    return (
      <div data-testid="advanced-devices">
        <span onClick={() => onAdvancedDevicesOpenChange?.(true)}>Advanced devices</span>
        <button type="button" onClick={onOpenFirstSuccessGuide}>First-success guide</button>
        {candidate?.kind === 'jlink' ? (
          <button type="button" onClick={() => onUseCandidate(candidate)}>Review this target</button>
        ) : null}
        <button type="button" onClick={onRefresh}>Refresh readiness</button>
        {state.diagnostics.length > 0 ? (
          <section role="region" aria-label="Diagnostics">Refresh failed</section>
        ) : null}
      </div>
    );
  },
}));

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

});
