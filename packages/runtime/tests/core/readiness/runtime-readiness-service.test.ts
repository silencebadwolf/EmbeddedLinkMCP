import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompensationCandidateSummary,
  ProfileSuggestionSummary,
  ReadinessCheck,
  ReusableProfile,
  RuntimeReadinessSnapshot,
} from '@/shared/readiness-contract.js';
import {
  READINESS_MAX_COMPENSATION_SUMMARIES,
  READINESS_MAX_PROFILE_SUGGESTIONS,
  READINESS_MAX_RECENT_ITEMS,
} from '@/shared/readiness-contract.js';
import {
  RuntimeReadinessService,
  type ReadinessProvider,
  type ReadinessProviderResult,
} from '@linkterm/runtime/core/readiness/runtime-readiness-service';

const NOW = '2026-07-13T00:00:00.000Z';

function check(
  id: string,
  status: ReadinessCheck['status'] = 'ready',
  scope: ReadinessCheck['scope'] = 'runtime',
): ReadinessCheck {
  return {
    id,
    scope,
    status,
    severity: status === 'ready' ? 'info' : 'warning',
    summaryCode: `readiness.${id}.${status}`,
    evidence: [],
    recommendedActions: [],
    checkedAt: NOW,
  };
}

function provider(
  id: string,
  scope: ReadinessCheck['scope'],
  result: ReadinessProviderResult,
): ReadinessProvider {
  return {
    id,
    scope,
    collect: vi.fn().mockResolvedValue(result),
  };
}

function compensationCandidate(index: number): CompensationCandidateSummary {
  return {
    schemaVersion: '1.0.0',
    candidateId: `compensation_${index}`,
    targetLabel: `Board ${index}`,
    firmware: {
      displayName: `app-${index}.bin`,
      hashSha256Prefix: '0123abcd',
      byteLength: 4096 + index,
    },
    createdAt: NOW,
    expiresAt: '2026-07-13T00:30:00.000Z',
    eligibility: { status: 'available' },
    actionCode: 'compensation.reflash.review',
  };
}

function profileSuggestion(index: number): ProfileSuggestionSummary {
  return {
    schemaVersion: '1.0.0',
    suggestionId: `profile_suggestion_${index}`,
    profileLabel: `Board ${index}`,
    provenance: 'verified-jlink-rtt-success',
    fields: [{ code: 'profile.target', label: `Board ${index}` }],
    saveActionCode: 'profile.suggestion.save',
    skipActionCode: 'profile.suggestion.skip',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RuntimeReadinessService', () => {
  it('combines display-safe provider results into a versioned snapshot', async () => {
    const service = new RuntimeReadinessService({
      providers: [
        provider('runtime', 'runtime', { checks: [check('runtime')] }),
        provider('serial', 'serial', {
          checks: [check('serial', 'ready', 'serial')],
          deviceCandidates: [
            {
              id: 'candidate_COM7',
              kind: 'serial',
              label: 'COM7 · USB Serial Device',
              confidence: 'likely',
              requiresUserConfirmation: true,
              evidence: [],
              serial: {
                portLabel: 'COM7',
                baudRate: 115_200,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
              },
            },
          ],
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot).toMatchObject({
      schemaVersion: '1.0.0',
      snapshotId: 'snapshot_1',
      generation: 1,
      status: 'ready',
      generatedAt: NOW,
      blockers: [],
      diagnostics: [],
    });
    expect(snapshot.checks.map((item) => item.id)).toEqual(['runtime', 'serial']);
    expect(snapshot.deviceCandidates).toHaveLength(1);
    expect(service.getCurrent()).toBe(snapshot);
  });

  it('keeps partial provider failures isolated and marks the aggregate action-required', async () => {
    const failingProvider: ReadinessProvider = {
      id: 'workspace',
      scope: 'workspace',
      collect: vi.fn().mockRejectedValue(new Error('raw C:/Users/Admin/private token=secret')),
    };
    const service = new RuntimeReadinessService({
      providers: [
        provider('runtime', 'runtime', { checks: [check('runtime')] }),
        failingProvider,
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('action-required');
    expect(snapshot.checks).toContainEqual(
      expect.objectContaining({
        id: 'workspace',
        scope: 'workspace',
        status: 'unavailable',
        severity: 'error',
        summaryCode: 'readiness.provider_failed',
      }),
    );
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'readiness.provider_failed',
        severity: 'error',
      }),
    );
    expect(JSON.stringify(snapshot)).not.toContain('private');
    expect(JSON.stringify(snapshot)).not.toContain('token=secret');
  });

  it('reports explicit blockers as the aggregate blocked state', async () => {
    const service = new RuntimeReadinessService({
      providers: [
        provider('serial', 'serial', {
          checks: [check('serial_permission', 'blocked', 'serial')],
          blockers: ['readiness.serial.permission_blocked'],
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockers).toEqual(['readiness.serial.permission_blocked']);
  });

  it('keeps optional no-workspace state from blocking serial observation readiness', async () => {
    const service = new RuntimeReadinessService({
      providers: [
        provider('serial', 'serial', { checks: [check('serial', 'ready', 'serial')] }),
        provider('workspace', 'workspace', {
          checks: [
            {
              ...check('workspace_optional', 'unavailable', 'workspace'),
              severity: 'info',
              summaryCode: 'readiness.workspace.not_selected',
            },
          ],
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('ready');
    expect(snapshot.checks.map((item) => [item.scope, item.status])).toEqual([
      ['serial', 'ready'],
      ['workspace', 'unavailable'],
    ]);
  });

  it('classifies provider timeout without committing raw errors', async () => {
    vi.useFakeTimers();
    const slowProvider: ReadinessProvider = {
      id: 'serial',
      scope: 'serial',
      collect: vi.fn(({ signal }) =>
        new Promise<ReadinessProviderResult>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('slow raw serial stack'));
          });
        }),
      ),
    };
    const service = new RuntimeReadinessService({
      providers: [slowProvider],
      providerTimeoutMs: 25,
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const pending = service.refresh();
    await vi.advanceTimersByTimeAsync(26);
    const snapshot = await pending;

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.checks).toContainEqual(
      expect.objectContaining({
        id: 'serial',
        scope: 'serial',
        status: 'unavailable',
        summaryCode: 'readiness.provider_timeout',
      }),
    );
    expect(JSON.stringify(snapshot)).not.toContain('raw serial stack');
  });

  it('does not let an older slow generation replace a newer snapshot', async () => {
    let resolveFirst: ((value: ReadinessProviderResult) => void) | undefined;
    let callCount = 0;
    const racingProvider: ReadinessProvider = {
      id: 'runtime',
      scope: 'runtime',
      collect: vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise<ReadinessProviderResult>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ checks: [check('runtime_new')] });
      }),
    };
    const service = new RuntimeReadinessService({
      providers: [racingProvider],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const first = service.refresh();
    const second = await service.refresh();

    expect(second.generation).toBe(2);
    expect(second.checks[0]?.id).toBe('runtime_new');
    expect(service.getCurrent()).toBe(second);

    resolveFirst?.({ checks: [check('runtime_old')] });
    const stale = await first;

    expect(stale.generation).toBe(1);
    expect(stale.checks[0]?.id).toBe('runtime_old');
    expect(service.getCurrent()).toBe(second);
  });

  it('validates provider output before committing a snapshot', async () => {
    const unsafeProvider: ReadinessProvider = {
      id: 'serial',
      scope: 'serial',
      collect: vi.fn().mockResolvedValue({
        checks: [
          {
            ...check('serial', 'ready', 'serial'),
            evidence: [
              {
                source: 'live-discovery',
                summaryCode: 'readiness.serial.detected',
                params: [{ key: 'workspace', value: 'C:/Users/Admin/private' }],
              },
            ],
          },
        ],
      }),
    };
    const service = new RuntimeReadinessService({
      providers: [unsafeProvider],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.checks[0]).toMatchObject({
      id: 'serial',
      status: 'unavailable',
      summaryCode: 'readiness.provider_invalid',
    });
    expect(JSON.stringify(snapshot)).not.toContain('C:/Users/Admin/private');
  });

  it('truncates oversized provider lists instead of dropping the provider contribution', async () => {
    const profiles: ReusableProfile[] = Array.from({ length: READINESS_MAX_RECENT_ITEMS + 3 }, (_, index) => ({
      id: `profile_${index}`,
      label: `Profile ${index}`,
      kind: 'control-profile' as const,
    }));
    const service = new RuntimeReadinessService({
      providers: [
        provider('workspace', 'workspace', {
          checks: [check('workspace', 'ready', 'workspace')],
          reusableProfiles: profiles,
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('ready');
    expect(snapshot.checks[0]).toMatchObject({
      id: 'workspace',
      status: 'ready',
    });
    expect(snapshot.reusableProfiles).toHaveLength(READINESS_MAX_RECENT_ITEMS);
    expect(snapshot.reusableProfiles[0]?.id).toBe('profile_0');
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'readiness.provider_truncated',
        severity: 'warning',
      }),
    );
  });

  it('aggregates display-safe compensation candidates and profile suggestions', async () => {
    const service = new RuntimeReadinessService({
      providers: [
        provider('jlink', 'jlink', {
          checks: [check('jlink', 'ready', 'jlink')],
          compensationCandidates: [compensationCandidate(1)],
          profileSuggestions: [profileSuggestion(1)],
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.status).toBe('ready');
    expect(snapshot.compensationCandidates).toEqual([compensationCandidate(1)]);
    expect(snapshot.profileSuggestions).toEqual([profileSuggestion(1)]);
    expect(JSON.stringify(snapshot)).not.toContain('mainOwnedSourceRef');
    expect(JSON.stringify(snapshot)).not.toContain('C:/Users/Admin/private');
  });

  it('bounds compensation candidates and profile suggestions with a truncation diagnostic', async () => {
    const service = new RuntimeReadinessService({
      providers: [
        provider('jlink', 'jlink', {
          checks: [check('jlink', 'ready', 'jlink')],
          compensationCandidates: Array.from(
            { length: READINESS_MAX_COMPENSATION_SUMMARIES + 2 },
            (_, index) => compensationCandidate(index),
          ),
          profileSuggestions: Array.from(
            { length: READINESS_MAX_PROFILE_SUGGESTIONS + 2 },
            (_, index) => profileSuggestion(index),
          ),
        }),
      ],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const snapshot = await service.refresh();

    expect(snapshot.compensationCandidates).toHaveLength(READINESS_MAX_COMPENSATION_SUMMARIES);
    expect(snapshot.profileSuggestions).toHaveLength(READINESS_MAX_PROFILE_SUGGESTIONS);
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'readiness.provider_truncated',
        severity: 'warning',
      }),
    );
  });

  it('returns a frozen empty checking snapshot before the first refresh', () => {
    const service = new RuntimeReadinessService({
      providers: [],
      now: () => NOW,
      createSnapshotId: (generation) => `snapshot_${generation}`,
    });

    const current = service.getCurrent();

    expect(current).toMatchObject({
      generation: 0,
      status: 'checking',
      checks: [],
      deviceCandidates: [],
    } satisfies Partial<RuntimeReadinessSnapshot>);
    expect(Object.isFrozen(current)).toBe(true);
  });
});
