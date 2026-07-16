// @vitest-environment happy-dom

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  READINESS_SCHEMA_VERSION,
  RuntimeReadinessSnapshotSchema,
  type RuntimeReadinessSnapshot,
} from '@/shared/readiness-contract.js';
import { StartCenter } from '@/renderer/features/readiness/StartCenter.js';
import { useAppStore } from '@/renderer/store/app-store.js';
import { installMockPreload } from '../../../fixtures/mock-preload-api.js';

vi.mock('../../../../src/renderer/components/TerminalView.js', () => ({
  TerminalView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-testid={`terminal-${sessionId ?? 'none'}`}>{sessionId}</div>
  ),
}));

vi.mock('../../../../src/renderer/components/ConnectionDialog.js', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

function largeSnapshot(): RuntimeReadinessSnapshot {
  const checkedAt = '2026-07-13T07:00:00.000Z';
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: 'readiness_large',
    generation: 7,
    status: 'action-required',
    generatedAt: checkedAt,
    checks: Array.from({ length: 12 }, (_, index) => ({
      id: `readiness.check.${index}`,
      scope: 'runtime',
      status: 'ready',
      severity: 'info',
      summaryCode: `readiness.check.${index}`,
      evidence: [],
      recommendedActions: [],
      checkedAt,
    })),
    deviceCandidates: Array.from({ length: 9 }, (_, index) => ({
      id: `candidate_serial_${index}`,
      kind: 'serial',
      label: `COM${index} · Candidate ${index}`,
      confidence: 'likely',
      requiresUserConfirmation: true,
      evidence: [
        {
          source: 'live-discovery',
          summaryCode: `readiness.serial.detected.${index}`,
          params: [{ key: 'port', value: `COM${index}` }],
        },
      ],
      serial: {
        portLabel: `COM${index}`,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      },
    })),
    reusableSessions: [],
    reusableProfiles: Array.from({ length: 8 }, (_, index) => ({
      id: `profile_${index}`,
      label: `Profile ${index}`,
      kind: 'control-profile',
    })),
    blockers: [],
    diagnostics: [],
  });
}

function resetStore(): void {
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
}

describe('StartCenter bounded rendering', () => {
  it('lets the start center reclaim width after the window is widened', () => {
    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: largeSnapshot(), diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    const shell = screen.getByTestId('start-center-shell');
    expect(shell).toHaveClass('w-full');
    expect(shell).toHaveClass('max-w-none');
    expect(shell).toHaveClass('min-h-0');
    expect(shell).toHaveClass('overflow-y-auto');
    const description = screen.getByTestId('start-center-description');
    expect(description).toHaveClass('w-full');
    expect(description).toHaveClass('max-w-none');
  });

  it('renders bounded rows for large readiness lists', () => {
    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: largeSnapshot(), diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    const advanced = screen.getByTestId('advanced-devices');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(screen.queryByRole('region', { name: 'Readiness checklist' })).toBeNull();

    expect(screen.queryByRole('region', { name: 'Serial devices' })).toBeNull();
    expect(screen.queryByText('COM5 · Candidate 5')).toBeNull();
    expect(screen.queryByText('COM6 · Candidate 6')).toBeNull();

    expect(screen.queryByRole('region', { name: 'Recent profiles' })).toBeNull();
  });

  it('keeps the active terminal canvas stable even when readiness has large lists', async () => {
    resetStore();
    const mock = installMockPreload();
    mock.setReadinessSnapshot(largeSnapshot());
    useAppStore.getState().addSession({
      id: 'sess_terminal',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    const { App } = await import('@/renderer/App.js');
    render(<App />);

    expect(await screen.findByTestId('terminal-sess_terminal')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Start Center' })).toBeNull();
    expect(screen.queryByText('readiness.check.0')).toBeNull();
    expect(screen.queryByText('COM0 · Candidate 0')).toBeNull();
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
  });
});
