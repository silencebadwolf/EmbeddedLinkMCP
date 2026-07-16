// @vitest-environment happy-dom

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../fixtures/mock-preload-api.js';
import type { FirstSuccessFlowProps } from '../../../src/renderer/features/first-success/FirstSuccessFlow.js';

vi.mock('../../../src/renderer/components/TerminalView.js', () => ({
  TerminalView: ({
    sessionId,
    onVisibleDeviceSequence,
  }: {
    sessionId: string | null;
    onVisibleDeviceSequence?: (ack: { sessionId: string; sequence: number }) => void;
  }) => (
    <div data-testid={`terminal-${sessionId ?? 'none'}`}>
      {sessionId}
      {sessionId !== null ? (
        <button
          type="button"
          data-testid={`terminal-visible-ack-${sessionId}`}
          onClick={() => onVisibleDeviceSequence?.({ sessionId, sequence: 1 })}
        >
          ack
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/ConnectionDialog.js', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

vi.mock('../../../src/renderer/features/first-success/FirstSuccessFlow.js', () => ({
  FirstSuccessFlow: ({ draft, state, onConfirmConnect }: FirstSuccessFlowProps) => (
    <section aria-label="mock first success flow">
      <div data-testid="first-success-phase">{state.phase}</div>
      <div data-testid="first-success-focus-terminal">{String(state.focusTerminal)}</div>
      <button type="button" onClick={() => onConfirmConnect(draft)}>
        Confirm connect
      </button>
    </section>
  ),
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

const setSingleSerialCandidate = (mock: MockPreloadAPI, portLabel: string): void => {
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
        evidence: [{ source: 'live-discovery', summaryCode: 'readiness.serial.detected' }],
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

describe('App first-success focus policy', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    cleanup();
    resetStore();
    mock = installMockPreload();
    mock.setReadinessSnapshot(mock.readinessSnapshot(1, 'action-required'));
  });

  it('completes without marking terminal auto-focus when Activity Center is open', async () => {
    setSingleSerialCandidate(mock, 'COM18');
    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'First-success guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm connect' }));
    await waitFor(() => expect(mock.spies.firstSignal.start).toHaveBeenCalledOnce());

    mock.emitFirstSignalEvent(
      mock.firstSignalObservation({
        state: 'signal-detected',
        revision: 2,
        observedSequence: 1,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'AI: Idle' }));
    fireEvent.click(await screen.findByTestId('terminal-visible-ack-sess_test'));

    expect(await screen.findByTestId('first-success-phase')).toHaveTextContent('completed');
    expect(screen.getByTestId('first-success-focus-terminal')).toHaveTextContent('false');
    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toBeVisible();
  });
});
