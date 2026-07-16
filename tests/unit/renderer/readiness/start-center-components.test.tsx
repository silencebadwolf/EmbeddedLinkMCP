// @vitest-environment happy-dom

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  READINESS_SCHEMA_VERSION,
  RuntimeReadinessSnapshotSchema,
  type RuntimeReadinessSnapshot,
} from '@/shared/readiness-contract.js';
import type { SavedConnectionSummary } from '@/shared/preload-api.js';
import { createInitialRuntimeReadinessState } from '@/renderer/features/readiness/readiness-reducer.js';
import { StartCenter } from '@/renderer/features/readiness/StartCenter.js';

function snapshot(
  input: Partial<RuntimeReadinessSnapshot> = {},
): RuntimeReadinessSnapshot {
  const checkedAt = '2026-07-13T05:00:00.000Z';
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: 'readiness_1',
    generation: 1,
    status: 'action-required',
    generatedAt: checkedAt,
    checks: [
      {
        id: 'runtime',
        scope: 'runtime',
        status: 'ready',
        severity: 'info',
        summaryCode: 'readiness.runtime.ready',
        evidence: [],
        recommendedActions: [],
        checkedAt,
      },
      {
        id: 'serial',
        scope: 'serial',
        status: 'action-required',
        severity: 'warning',
        summaryCode: 'readiness.serial.empty',
        evidence: [],
        recommendedActions: [],
        checkedAt,
      },
    ],
    deviceCandidates: [],
    reusableSessions: [],
    reusableProfiles: [],
    blockers: [],
    diagnostics: [],
    ...input,
  });
}

describe('StartCenter readiness components', () => {
  it('shows saved connections before the single manual-open entry', () => {
    const onOpenSavedConnection = vi.fn();
    const saved: SavedConnectionSummary = {
      id: 'conn_com6',
      label: 'FNA board',
      type: 'serial',
      config: { type: 'serial', port: 'COM6', baudRate: 115200, mode: 'terminal' },
      hasCredential: false,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };

    render(
      <StartCenter
        state={createInitialRuntimeReadinessState()}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        savedConnections={[saved]}
        onOpenSavedConnection={onOpenSavedConnection}
      />,
    );

    const region = screen.getByRole('region', { name: 'Saved connections' });
    expect(region).toHaveTextContent('FNA board');
    expect(region).toHaveTextContent('COM6 · 115200');
    expect(
      region.compareDocumentPosition(screen.getByTestId('manual-open-entry')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Open saved connection' }));
    expect(onOpenSavedConnection).toHaveBeenCalledWith(saved);
  });

  it('uses one manual-open action and does not show serial discovery on Start Center', () => {
    const onOpenSerialTerminal = vi.fn();
    const current = snapshot({
      deviceCandidates: [
        {
          id: 'candidate_serial_COM10',
          kind: 'serial',
          label: 'COM10 · USB Serial Device',
          confidence: 'likely',
          requiresUserConfirmation: false,
          evidence: [{ source: 'live-discovery', summaryCode: 'readiness.serial.detected' }],
          serial: {
            portLabel: 'COM10',
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          },
        },
      ],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: current, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onOpenSerialTerminal={onOpenSerialTerminal}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manual open' }));

    expect(onOpenSerialTerminal).toHaveBeenCalledOnce();
    expect(screen.getAllByTestId('start-center-primary-action')).toHaveLength(1);
    expect(screen.queryByText('COM10 · USB Serial Device')).toBeNull();
    expect(screen.queryByRole('button', { name: 'First-success guide' })).toBeNull();
  });

  it('keeps advanced device facts collapsed without showing serial candidates', () => {
    const current = snapshot({
      deviceCandidates: [
        {
          id: 'candidate_serial_COM10',
          kind: 'serial',
          label: 'COM10 · USB Serial Device',
          confidence: 'likely',
          requiresUserConfirmation: false,
          evidence: [{ source: 'live-discovery', summaryCode: 'readiness.serial.detected' }],
          serial: {
            portLabel: 'COM10',
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          },
        },
        {
          id: 'candidate_jlink_1',
          kind: 'jlink',
          label: 'J-Link EDU',
          confidence: 'likely',
          requiresUserConfirmation: true,
          evidence: [{ source: 'probe-detect', summaryCode: 'readiness.jlink.probe.detected' }],
        },
      ],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: current, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onOpenSerialTerminal={vi.fn()}
        onOpenFirstSuccessGuide={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Serial devices' })).toBeNull();
    expect(screen.queryByText('COM10 · USB Serial Device')).toBeNull();
    const advanced = screen.getByTestId('advanced-devices');
    expect(advanced).not.toHaveAttribute('open');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(advanced).toHaveAttribute('open');
    expect(advanced).toHaveTextContent('J-Link EDU');
    expect(advanced).toHaveTextContent('MCP / Agent injection');
    expect(advanced).toHaveTextContent('Control profiles');
  });

  it('does not render a standalone manual serial form', () => {
    render(
      <StartCenter
        state={createInitialRuntimeReadinessState()}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onOpenSerialTerminal={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('manual-port-entry')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Manual serial port' })).toBeNull();
  });

  it('renders saved-empty state without readiness or first-signal language', () => {
    render(
      <StartCenter
        state={createInitialRuntimeReadinessState()}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Saved connections' })).toHaveTextContent(
      'No saved connections yet.',
    );
    expect(screen.getByRole('button', { name: 'Manual open' })).toBeInTheDocument();
    expect(screen.queryByText(/first signal|waiting for device text|completion ack/i)).toBeNull();
    expect(screen.queryByRole('status', { name: 'Runtime readiness' })).toBeNull();
  });

  it('shows saved connections before manual open and keeps the primary task bounded', () => {
    const ready = snapshot({
      status: 'ready',
      checks: [
        {
          id: 'runtime',
          scope: 'runtime',
          status: 'ready',
          severity: 'info',
          summaryCode: 'readiness.runtime.ready',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
        {
          id: 'serial',
          scope: 'serial',
          status: 'ready',
          severity: 'info',
          summaryCode: 'readiness.serial.ready',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
      ],
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
              params: [
                { key: 'port', value: 'COM7' },
                { key: 'name', value: 'USB Serial Device' },
              ],
            },
          ],
          serial: {
            portLabel: 'COM7',
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          },
        },
      ],
      reusableProfiles: [{ id: 'profile_1', label: 'Eval board', kind: 'control-profile' }],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: ready, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        savedConnections={[
          {
            id: 'conn_eval',
            label: 'Eval board',
            type: 'serial',
            config: { type: 'serial', port: 'COM7', baudRate: 115200, mode: 'terminal' },
            hasCredential: false,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Start Center' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Saved connections' })).toHaveTextContent('Eval board');
    expect(screen.getByRole('region', { name: 'Saved connections' })).toHaveTextContent('COM7 · 115200');
    expect(screen.queryByText('Serial device detected')).toBeNull();
    expect(screen.getAllByTestId('start-center-primary-action')).toHaveLength(1);
  });

  it('supports manual open, advanced diagnostics, and safe diagnostic copy', () => {
    const onAdvancedConnection = vi.fn();
    const onCopyDiagnostics = vi.fn();
    const current = snapshot({
      diagnostics: [
        {
          code: 'readiness.serial.discovery_failed',
          severity: 'error',
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
      ],
    });

    render(
      <StartCenter
        state={{
          phase: 'ready',
          refreshing: false,
          snapshot: current,
          diagnostics: [{ code: 'readiness.preferences.corrupt', severity: 'warning' }],
        }}
        onRefresh={vi.fn()}
        onAdvancedConnection={onAdvancedConnection}
        onCopyDiagnostics={onCopyDiagnostics}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manual open' }));
    expect(onAdvancedConnection).toHaveBeenCalledOnce();

    const advanced = screen.getByTestId('advanced-devices');
    fireEvent.click(within(advanced).getByText('Advanced devices'));
    expect(within(advanced).getByRole('button', { name: 'Refresh readiness' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(onCopyDiagnostics).toHaveBeenCalledWith([
      'readiness.preferences.corrupt',
      'readiness.serial.discovery_failed',
    ]);
    expect(JSON.stringify(onCopyDiagnostics.mock.calls)).not.toContain('C:/Users');
  });

  it('does not render discovered ports before manual open', () => {
    const onAdvancedConnection = vi.fn();
    const current = snapshot({
      deviceCandidates: [
        {
          id: 'candidate_serial_COM7',
          kind: 'serial',
          label: 'COM7',
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
        {
          id: 'candidate_serial_COM8',
          kind: 'serial',
          label: 'COM8',
          confidence: 'likely',
          requiresUserConfirmation: true,
          evidence: [{ source: 'live-discovery', summaryCode: 'readiness.serial.detected' }],
          serial: {
            portLabel: 'COM8',
            baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          },
        },
      ],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: current, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={onAdvancedConnection}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manual open' }));

    expect(onAdvancedConnection).toHaveBeenCalledOnce();
  });

  it('renders J-Link/RTT readiness, compensation, and profile suggestions without rollback wording', () => {
    const onUseCandidate = vi.fn();
    const onReviewReflash = vi.fn();
    const onSaveProfileSuggestion = vi.fn();
    const onSkipProfileSuggestion = vi.fn();
    const current = snapshot({
      status: 'action-required',
      checks: [
        {
          id: 'jlink',
          scope: 'jlink',
          status: 'ready',
          severity: 'info',
          summaryCode: 'readiness.jlink.ready',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
        {
          id: 'firmware',
          scope: 'firmware',
          status: 'ready',
          severity: 'info',
          summaryCode: 'readiness.firmware.ready',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
        {
          id: 'rtt',
          scope: 'rtt',
          status: 'action-required',
          severity: 'warning',
          summaryCode: 'readiness.rtt.config_missing',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
      ],
      deviceCandidates: [
        {
          id: 'candidate_jlink_probe_a',
          kind: 'jlink',
          label: 'J-Link probe A · STM32H743',
          confidence: 'unknown',
          requiresUserConfirmation: true,
          evidence: [
            {
              source: 'probe-detect',
              summaryCode: 'readiness.jlink.probe.detected',
              params: [{ key: 'target', value: 'STM32H743' }],
            },
          ],
          jlink: {
            probeLabel: 'J-Link probe A',
            targetLabel: 'STM32H743',
          },
        },
      ],
      compensationCandidates: [
        {
          schemaVersion: READINESS_SCHEMA_VERSION,
          candidateId: 'compensation_1',
          targetLabel: 'STM32H743',
          firmware: {
            displayName: 'rtthread.bin',
            hashSha256Prefix: 'aaaaaaaaaaaaaaaa',
            byteLength: 4096,
          },
          createdAt: '2026-07-13T05:00:00.000Z',
          expiresAt: '2026-07-13T05:30:00.000Z',
          eligibility: { status: 'available' },
          actionCode: 'compensation.reflash.review',
        },
      ],
      profileSuggestions: [
        {
          schemaVersion: READINESS_SCHEMA_VERSION,
          suggestionId: 'profile_suggestion_1',
          profileLabel: 'STM32H743',
          provenance: 'verified-jlink-rtt-success',
          fields: [
            { code: 'profile.target', label: 'STM32H743' },
            { code: 'profile.firmware', label: 'rtthread.bin' },
          ],
          saveActionCode: 'profile.suggestion.save',
          skipActionCode: 'profile.suggestion.skip',
        },
      ],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: current, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={onUseCandidate}
        onCopyDiagnostics={vi.fn()}
        onReviewReflash={onReviewReflash}
        onSaveProfileSuggestion={onSaveProfileSuggestion}
        onSkipProfileSuggestion={onSkipProfileSuggestion}
      />,
    );

    expect(screen.queryByText('J-Link is ready')).toBeNull();
    expect(screen.queryByText('Firmware metadata is ready')).toBeNull();
    expect(screen.queryByText('RTT configuration is missing')).toBeNull();
    const candidate = screen.getByTestId('device-candidate-candidate_jlink_probe_a');
    expect(candidate).toHaveTextContent('J-Link probe A · STM32H743');
    fireEvent.click(within(candidate).getByRole('button', { name: 'Review this target' }));
    expect(onUseCandidate).toHaveBeenCalledWith(current.deviceCandidates[0]);

    expect(screen.getByRole('region', { name: 'Known-good recovery' })).toHaveTextContent(
      'Review reflash plan',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review reflash plan' }));
    expect(onReviewReflash).toHaveBeenCalledWith('compensation_1');
    expect(screen.getAllByText(/rtthread\.bin/u).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Profile suggestions' })).toHaveTextContent(
      'Save suggestion',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save suggestion' }));
    expect(onSaveProfileSuggestion).toHaveBeenCalledWith('profile_suggestion_1');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkipProfileSuggestion).toHaveBeenCalledWith('profile_suggestion_1');
    expect(screen.getByText('Verified J-Link/RTT success')).toBeInTheDocument();
    expect(screen.queryByText(/rollback/i)).toBeNull();
  });

  it('shows empty and blocked states without creating sessions or touching hardware paths', () => {
    const forbidden = {
      createSession: vi.fn(),
      flash: vi.fn(),
      reset: vi.fn(),
      jlink: vi.fn(),
    };
    const blocked = snapshot({
      status: 'blocked',
      blockers: ['readiness.serial.permission_blocked'],
      checks: [
        {
          id: 'serial',
          scope: 'serial',
          status: 'blocked',
          severity: 'error',
          summaryCode: 'readiness.serial.permission_blocked',
          evidence: [],
          recommendedActions: [],
          checkedAt: '2026-07-13T05:00:00.000Z',
        },
      ],
    });

    render(
      <StartCenter
        state={{ phase: 'ready', refreshing: false, snapshot: blocked, diagnostics: [] }}
        onRefresh={vi.fn()}
        onAdvancedConnection={vi.fn()}
        onUseCandidate={vi.fn()}
        onCopyDiagnostics={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Serial permission blocked').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Manual open' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Serial devices' })).toBeNull();
    for (const spy of Object.values(forbidden)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
