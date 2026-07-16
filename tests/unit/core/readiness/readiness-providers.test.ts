import { describe, expect, it, vi } from 'vitest';
import {
  createAgentIntegrationProvider,
  createCompensationSummaryProvider,
  createFirmwareReadinessProvider,
  createJLinkReadinessProvider,
  createRttReadinessProvider,
  createReusableSessionsProvider,
  createRuntimeStatusProvider,
  createSerialDiscoveryProvider,
  createWorkspaceProfileProvider,
} from '@/core/readiness/readiness-providers.js';
import type { ReadinessProviderContext } from '@/core/readiness/runtime-readiness-service.js';

const CONTEXT: ReadinessProviderContext = {
  generation: 1,
  checkedAt: '2026-07-13T00:00:00.000Z',
  signal: new AbortController().signal,
};

describe('read-only readiness providers', () => {
  it('maps runtime status facts without exposing raw details', async () => {
    const provider = createRuntimeStatusProvider({
      getStatus: vi.fn().mockResolvedValue({ codeFresh: true, runtimeFresh: true }),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'runtime',
        scope: 'runtime',
        status: 'ready',
        summaryCode: 'readiness.runtime.ready',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('stack');
  });

  it('separates serial ready, empty, and discovery error states', async () => {
    const ready = createSerialDiscoveryProvider({
      listPorts: vi.fn().mockResolvedValue([{ path: 'COM7', friendlyName: 'USB Serial Device' }]),
    });
    const empty = createSerialDiscoveryProvider({ listPorts: vi.fn().mockResolvedValue([]) });
    const failed = createSerialDiscoveryProvider({
      listPorts: vi.fn().mockRejectedValue(new Error('raw serial stack C:/private')),
    });

    await expect(ready.collect(CONTEXT)).resolves.toMatchObject({
      checks: [expect.objectContaining({ status: 'ready', summaryCode: 'readiness.serial.ready' })],
      deviceCandidates: [expect.objectContaining({ id: 'candidate_serial_COM7' })],
    });
    await expect(empty.collect(CONTEXT)).resolves.toMatchObject({
      checks: [
        expect.objectContaining({
          status: 'action-required',
          summaryCode: 'readiness.serial.empty',
        }),
      ],
      deviceCandidates: [],
    });
    const failure = await failed.collect(CONTEXT);
    expect(failure.checks).toContainEqual(
      expect.objectContaining({
        status: 'unavailable',
        summaryCode: 'readiness.serial.discovery_failed',
      }),
    );
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it('maps active sessions to reusable display-safe summaries', async () => {
    const provider = createReusableSessionsProvider({
      listSessions: vi.fn().mockResolvedValue([
        {
          sessionId: 'sess_1',
          label: 'serial COM7',
          connectionType: 'serial',
          state: 'open',
        },
      ]),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'session', status: 'ready' }),
    );
    expect(result.reusableSessions).toEqual([
      { id: 'sess_1', label: 'serial COM7', kind: 'serial' },
    ]);
  });

  it('treats missing workspace/profile as optional info, not a blocker', async () => {
    const provider = createWorkspaceProfileProvider({
      listProfiles: vi.fn().mockResolvedValue([]),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'workspace',
        scope: 'workspace',
        status: 'unavailable',
        severity: 'info',
        summaryCode: 'readiness.workspace.not_selected',
      }),
    );
    expect(result.reusableProfiles).toEqual([]);
  });

  it('maps saved profiles to display-safe summaries without raw roots', async () => {
    const provider = createWorkspaceProfileProvider({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile_1',
          label: 'board-a',
          root: 'C:/Users/Admin/private/board-a',
        },
      ]),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'workspace', status: 'ready' }),
    );
    expect(result.reusableProfiles).toEqual([
      { id: 'profile_1', label: 'board-a', kind: 'control-profile' },
    ]);
    expect(JSON.stringify(result)).not.toContain('C:/Users/Admin/private');
  });

  it('maps agent integration availability without blocking manual app use', async () => {
    const provider = createAgentIntegrationProvider({
      listAgents: vi.fn().mockResolvedValue([
        { id: 'codex', label: 'Codex', installed: false, diagnosticCode: 'agent.missing' },
      ]),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'agent',
        scope: 'agent',
        status: 'action-required',
        severity: 'warning',
      }),
    );
  });

  it('uses only injected read-only dependencies', async () => {
    const listPorts = vi.fn().mockResolvedValue([]);
    const forbidden = {
      createSession: vi.fn(),
      writeSerial: vi.fn(),
      reset: vi.fn(),
      flash: vi.fn(),
      startJlink: vi.fn(),
      mutateWorkspace: vi.fn(),
    };
    const provider = createSerialDiscoveryProvider({ listPorts });

    await provider.collect(CONTEXT);

    expect(listPorts).toHaveBeenCalledTimes(1);
    for (const spy of Object.values(forbidden)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('reports unavailable J-Link backend without hardware side effects', async () => {
    const forbidden = {
      probeConnect: vi.fn(),
      cpuReset: vi.fn(),
      flashDownload: vi.fn(),
      gdbServerStart: vi.fn(),
      rttConnect: vi.fn(),
      mutateWorkspace: vi.fn(),
    };
    const provider = createJLinkReadinessProvider({});

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'jlink',
        scope: 'jlink',
        status: 'unavailable',
        summaryCode: 'readiness.jlink.backend.unavailable',
      }),
    );
    expect(result.deviceCandidates).toEqual([]);
    for (const spy of Object.values(forbidden)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('maps detected J-Link probes to display-safe candidates without serial leakage', async () => {
    const detectProbes = vi.fn().mockResolvedValue([
      {
        probeId: 'probe_a',
        label: 'J-Link probe A',
        serialNumber: '123456789',
        target: 'STM32H743',
        connected: false,
      },
    ]);
    const provider = createJLinkReadinessProvider({
      detectProbes,
      targetName: vi.fn().mockResolvedValue('STM32H743'),
      hasTargetInCatalog: vi.fn().mockResolvedValue(true),
    });

    const result = await provider.collect(CONTEXT);

    expect(detectProbes).toHaveBeenCalledTimes(1);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'jlink',
        scope: 'jlink',
        status: 'ready',
        summaryCode: 'readiness.jlink.ready',
      }),
    );
    expect(result.deviceCandidates).toEqual([
      expect.objectContaining({
        id: 'candidate_jlink_probe_a',
        kind: 'jlink',
        label: 'J-Link probe A · STM32H743',
        confidence: 'likely',
        requiresUserConfirmation: true,
        jlink: expect.objectContaining({
          probeLabel: 'J-Link probe A',
          targetLabel: 'STM32H743',
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('123456789');
  });

  it('keeps target catalog misses actionable without auto-selecting hardware', async () => {
    const provider = createJLinkReadinessProvider({
      detectProbes: vi.fn().mockResolvedValue([{ probeId: 'probe_a', label: 'probe-a' }]),
      targetName: vi.fn().mockResolvedValue('UnknownTarget'),
      hasTargetInCatalog: vi.fn().mockResolvedValue(false),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'jlink',
        status: 'action-required',
        summaryCode: 'readiness.jlink.target_not_in_catalog',
      }),
    );
    expect(result.deviceCandidates?.[0]).toMatchObject({
      confidence: 'unknown',
      requiresUserConfirmation: true,
    });
  });

  it('maps firmware readiness from safe metadata without exposing source paths or bytes', async () => {
    const provider = createFirmwareReadinessProvider({
      readFirmwareMetadata: vi.fn().mockResolvedValue({
        displayName: String.raw`C:\Users\Admin\private\app.bin`,
        hashSha256Prefix: '0123abcd',
        byteLength: 65_536,
        format: 'bin',
        baseAddress: 0x08000000,
        verify: true,
      }),
    });

    const result = await provider.collect(CONTEXT);

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'firmware',
        scope: 'firmware',
        status: 'ready',
        summaryCode: 'readiness.firmware.ready',
      }),
    );
    expect(result.diagnostics ?? []).toEqual([]);
    expect(JSON.stringify(result)).toContain('app.bin');
    expect(JSON.stringify(result)).not.toContain('Users');
    expect(JSON.stringify(result)).not.toContain('bytesBase64');
  });

  it('reports missing RTT configuration as action-required and ready RTT as read-only', async () => {
    const missing = createRttReadinessProvider({
      readRttConfig: vi.fn().mockResolvedValue(undefined),
    });
    const ready = createRttReadinessProvider({
      readRttConfig: vi.fn().mockResolvedValue({
        channelIndex: 0,
        maxBytes: 4096,
        timeoutMs: 15_000,
        markers: ['ready', 'boot'],
      }),
    });

    await expect(missing.collect(CONTEXT)).resolves.toMatchObject({
      checks: [
        expect.objectContaining({
          id: 'rtt',
          scope: 'rtt',
          status: 'action-required',
          summaryCode: 'readiness.rtt.config_missing',
        }),
      ],
    });
    await expect(ready.collect(CONTEXT)).resolves.toMatchObject({
      checks: [
        expect.objectContaining({
          id: 'rtt',
          scope: 'rtt',
          status: 'ready',
          summaryCode: 'readiness.rtt.ready',
        }),
      ],
    });
  });

  it('projects Main-only compensation summaries through a read-only display-safe provider', async () => {
    const summaries = vi.fn().mockReturnValue([
      {
        schemaVersion: '1.0.0',
        candidateId: 'compensation_1',
        targetLabel: 'STM32H743',
        firmware: {
          displayName: 'app.bin',
          hashSha256Prefix: '0123abcd',
          byteLength: 4096,
        },
        createdAt: CONTEXT.checkedAt,
        expiresAt: '2026-07-13T00:30:00.000Z',
        eligibility: { status: 'available' },
        actionCode: 'compensation.reflash.review',
      },
    ]);
    const profileSuggestions = vi.fn().mockReturnValue([
      {
        schemaVersion: '1.0.0',
        suggestionId: 'profile_suggestion_1',
        profileLabel: 'STM32H743',
        provenance: 'verified-jlink-rtt-success',
        fields: [{ code: 'profile.target', label: 'STM32H743' }],
        saveActionCode: 'profile.suggestion.save',
        skipActionCode: 'profile.suggestion.skip',
      },
    ]);
    const forbidden = {
      flashDownload: vi.fn(),
      probeConnect: vi.fn(),
      rttConnect: vi.fn(),
      mutateCandidate: vi.fn(),
    };
    const provider = createCompensationSummaryProvider({ summaries, profileSuggestions });

    const result = await provider.collect(CONTEXT);

    expect(summaries).toHaveBeenCalledTimes(1);
    expect(result.compensationCandidates).toEqual([
      expect.objectContaining({
        candidateId: 'compensation_1',
        targetLabel: 'STM32H743',
        actionCode: 'compensation.reflash.review',
      }),
    ]);
    expect(result.profileSuggestions).toEqual([
      expect.objectContaining({
        suggestionId: 'profile_suggestion_1',
        provenance: 'verified-jlink-rtt-success',
      }),
    ]);
    expect(result.checks).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('mainOwnedSourceRef');
    expect(JSON.stringify(result)).not.toContain('rollback');
    for (const spy of Object.values(forbidden)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
