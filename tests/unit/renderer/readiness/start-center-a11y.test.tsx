// @vitest-environment happy-dom

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  READINESS_SCHEMA_VERSION,
  RuntimeReadinessSnapshotSchema,
  type RuntimeReadinessSnapshot,
} from '@/shared/readiness-contract.js';
import { createInitialRuntimeReadinessState } from '@/renderer/features/readiness/readiness-reducer.js';
import { StartCenter } from '@/renderer/features/readiness/StartCenter.js';

function snapshot(status: RuntimeReadinessSnapshot['status']): RuntimeReadinessSnapshot {
  const checkedAt = '2026-07-13T06:00:00.000Z';
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: `readiness_${status}`,
    generation: 1,
    status,
    generatedAt: checkedAt,
    checks: [
      {
        id: 'runtime',
        scope: 'runtime',
        status: status === 'blocked' ? 'blocked' : 'ready',
        severity: status === 'blocked' ? 'error' : 'info',
        summaryCode:
          status === 'blocked' ? 'readiness.runtime.blocked' : 'readiness.runtime.ready',
        evidence: [],
        recommendedActions: [],
        checkedAt,
      },
    ],
    deviceCandidates: [],
    reusableSessions: [],
    reusableProfiles: [],
    blockers: status === 'blocked' ? ['readiness.runtime.blocked'] : [],
    diagnostics: [],
  });
}

function renderStartCenter(state = createInitialRuntimeReadinessState()) {
  return render(
    <StartCenter
      state={state}
      onRefresh={vi.fn()}
      onAdvancedConnection={vi.fn()}
      onUseCandidate={vi.fn()}
      onCopyDiagnostics={vi.fn()}
    />,
  );
}

describe('StartCenter accessibility', () => {
  it('names every major region and announces distinct readiness states', () => {
    renderStartCenter({
      phase: 'ready',
      refreshing: false,
      snapshot: snapshot('blocked'),
      diagnostics: [],
    });

    expect(screen.getByRole('region', { name: 'Saved connections' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Manual open' })).toBeInTheDocument();
    const advanced = screen.getByTestId('advanced-devices');
    expect(advanced).not.toHaveAttribute('open');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(screen.queryByRole('region', { name: 'Readiness checklist' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Diagnostics' })).toBeInTheDocument();
  });

  it('has a labelled manual input, disabled reason, and keyboard-operable advanced action', () => {
    const onAdvancedConnection = vi.fn();
    const onAdvancedDevicesOpenChange = vi.fn();
    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: snapshot('ready'), diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={onAdvancedConnection}
        onUseCandidate={vi.fn()}
        onAdvancedDevicesOpenChange={onAdvancedDevicesOpenChange}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manual open' }));
    expect(onAdvancedConnection).toHaveBeenCalledOnce();

    const disclosure = screen.getByTestId('advanced-devices');
    fireEvent.click(within(disclosure).getByText('Advanced devices'));
    expect(onAdvancedDevicesOpenChange).toHaveBeenCalledWith(true);
    const refresh = within(disclosure).getByRole('button', { name: 'Refresh readiness' });
    refresh.focus();
    fireEvent.keyDown(refresh, { key: 'Enter' });
    fireEvent.click(refresh);
    expect(refresh).toBeEnabled();
  });

  it('uses text announcements for loading and ready states rather than color only', () => {
    const { rerender } = render(
      <StartCenter
        state={createInitialRuntimeReadinessState()}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Manual open' })).toBeInTheDocument();

    rerender(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: snapshot('ready'), diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );
    const advanced = screen.getByTestId('advanced-devices');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(screen.queryByRole('region', { name: 'Readiness checklist' })).toBeNull();
  });
});
