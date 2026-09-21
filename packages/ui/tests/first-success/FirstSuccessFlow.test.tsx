// @vitest-environment happy-dom

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FirstSuccessFlow } from '@linkterm/ui/features/first-success/FirstSuccessFlow';
import {
  createInitialFirstSuccessState,
  type FirstSuccessState,
} from '@linkterm/ui/features/first-success/first-success-reducer';
import { createDraftFromCandidate, createManualSerialDraft } from '../../../../src/shared/serial-connection-draft.js';
import type { DeviceCandidate } from '../../../../src/shared/readiness-contract.js';

function candidate(): DeviceCandidate {
  return {
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
  };
}

function reviewingState(draftId = 'candidate_serial_COM7'): FirstSuccessState {
  return {
    ...createInitialFirstSuccessState(),
    phase: 'reviewing-plan',
    phaseHistory: ['checking', 'ready-to-connect', 'reviewing-plan'],
    draftId,
  };
}

describe('FirstSuccessFlow', () => {
  it('renders an explicit serial plan review before any connection side effect', () => {
    const draft = createDraftFromCandidate(candidate(), { draftId: 'candidate_serial_COM7' });
    const onConfirmConnect = vi.fn();
    const onCancel = vi.fn();

    render(
      <FirstSuccessFlow
        draft={draft}
        state={reviewingState()}
        onConfirmConnect={onConfirmConnect}
        onCancel={onCancel}
        onKeepWaiting={vi.fn()}
        onDisconnectAndEdit={vi.fn()}
        onBackToSession={vi.fn()}
        onDisconnect={vi.fn()}
        onRetry={vi.fn()}
        onGoToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Review serial first signal' })).toBeInTheDocument();
    expect(screen.getByText('COM7')).toBeInTheDocument();
    expect(screen.getByText('230400')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('even')).toBeInTheDocument();
    expect(screen.getByText('Reserves this serial port exclusively while connected.')).toBeInTheDocument();
    expect(screen.getByText('No payload will be sent when the port opens.')).toBeInTheDocument();
    expect(screen.getByText('DTR/RTS: LinkTerm default serial open behavior.')).toBeInTheDocument();
    expect(screen.getByText('Opening this port may reset the board.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm connect' }));
    expect(onConfirmConnect).toHaveBeenCalledWith(draft);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('describes unknown DTR/RTS control-line behavior explicitly', () => {
    const baseDraft = createDraftFromCandidate(candidate(), { draftId: 'candidate_serial_COM7' });
    const draft = {
      ...baseDraft,
      sideEffects: {
        reservesPort: true as const,
        sendsPayloadOnConnect: false as const,
        mayResetBoard: false,
      },
    };

    render(
      <FirstSuccessFlow
        draft={draft}
        state={reviewingState()}
        onConfirmConnect={vi.fn()}
        onCancel={vi.fn()}
        onKeepWaiting={vi.fn()}
        onDisconnectAndEdit={vi.fn()}
        onBackToSession={vi.fn()}
        onDisconnect={vi.fn()}
        onRetry={vi.fn()}
        onGoToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText('DTR/RTS: Control-line behavior is not known yet.')).toBeInTheDocument();
    expect(screen.queryByText('Opening this port may reset the board.')).toBeNull();
  });

  it('shows recovery actions without exposing session-closing actions for reused sessions', () => {
    const draft = createManualSerialDraft({ draftId: 'manual_COM10', portLabel: 'COM10' });
    const onKeepWaiting = vi.fn();
    const onDisconnectAndEdit = vi.fn();
    const state: FirstSuccessState = {
      ...createInitialFirstSuccessState(),
      phase: 'silent',
      phaseHistory: ['checking', 'reviewing-plan', 'connecting', 'waiting-for-output', 'silent'],
      draftId: 'manual_COM10',
      attemptId: 'attempt_1',
      sessionId: 'sess_reused',
      ownsSession: false,
      focusTerminal: false,
      goToTerminalAvailable: true,
    };

    render(
      <FirstSuccessFlow
        draft={draft}
        state={state}
        onConfirmConnect={vi.fn()}
        onCancel={vi.fn()}
        onKeepWaiting={onKeepWaiting}
        onDisconnectAndEdit={onDisconnectAndEdit}
        onBackToSession={vi.fn()}
        onDisconnect={vi.fn()}
        onRetry={vi.fn()}
        onGoToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No device text yet. The monitor is still listening.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(onKeepWaiting).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Disconnect and edit' })).toBeNull();
    expect(onDisconnectAndEdit).not.toHaveBeenCalled();
  });

  it('exposes non-color-only status and named keyboard-reachable controls', () => {
    const draft = createManualSerialDraft({ draftId: 'manual_COM10', portLabel: 'COM10' });
    const state: FirstSuccessState = {
      ...createInitialFirstSuccessState(),
      phase: 'display-unavailable',
      phaseHistory: ['checking', 'waiting-for-output', 'data-received', 'display-unavailable'],
      draftId: 'manual_COM10',
      attemptId: 'attempt_1',
      sessionId: 'sess_test',
      ownsSession: true,
      observedSequence: 2,
      focusTerminal: false,
      goToTerminalAvailable: true,
    };

    render(
      <FirstSuccessFlow
        draft={draft}
        state={state}
        onConfirmConnect={vi.fn()}
        onCancel={vi.fn()}
        onKeepWaiting={vi.fn()}
        onDisconnectAndEdit={vi.fn()}
        onBackToSession={vi.fn()}
        onDisconnect={vi.fn()}
        onRetry={vi.fn()}
        onGoToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Device text arrived, but the terminal display is not ready yet.',
    );
    for (const name of [
      'Cancel',
      'Keep waiting',
      'Disconnect and edit',
      'Back to session',
      'Disconnect',
      'Retry',
      'Go to terminal',
    ]) {
      const button = screen.getByRole('button', { name });
      button.focus();
      expect(button).toHaveFocus();
    }
  });

  it('surfaces terminal handoff only after first success can go to the terminal', () => {
    const draft = createManualSerialDraft({ draftId: 'manual_COM10', portLabel: 'COM10' });
    const onGoToTerminal = vi.fn();
    const state: FirstSuccessState = {
      ...createInitialFirstSuccessState(),
      phase: 'completed',
      phaseHistory: ['checking', 'waiting-for-output', 'data-received', 'completed'],
      draftId: 'manual_COM10',
      attemptId: 'attempt_1',
      sessionId: 'sess_test',
      ownsSession: true,
      observedSequence: 4,
      lastVisibleDeviceSequence: 4,
      focusTerminal: true,
      goToTerminalAvailable: true,
    };

    render(
      <FirstSuccessFlow
        draft={draft}
        state={state}
        onConfirmConnect={vi.fn()}
        onCancel={vi.fn()}
        onKeepWaiting={vi.fn()}
        onDisconnectAndEdit={vi.fn()}
        onBackToSession={vi.fn()}
        onDisconnect={vi.fn()}
        onRetry={vi.fn()}
        onGoToTerminal={onGoToTerminal}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('First signal confirmed in the terminal.');
    fireEvent.click(screen.getByRole('button', { name: 'Go to terminal' }));
    expect(onGoToTerminal).toHaveBeenCalledOnce();
  });
});
