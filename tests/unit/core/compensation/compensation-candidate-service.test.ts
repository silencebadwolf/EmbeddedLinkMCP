import { describe, expect, it } from 'vitest';
import {
  CompensationCandidateService,
  type VerifiedDeploymentEvidence,
} from '@/core/compensation/compensation-candidate-service.js';

const BASE_EVIDENCE: VerifiedDeploymentEvidence = {
  workspace: {
    root: 'C:/repo',
    profile: {
      schemaVersion: 'linkterm-control/1.0.0',
      jlink: {
        enabled: true,
        target: 'STM32H743II',
        interface: 'swd',
        speedKHz: 4000,
      },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24000000' },
    },
  },
  sourceOperationId: 'operation_1',
  targetLabel: 'STM32H743II',
  targetBindingDigest: 'target_digest_1',
  profileRevision: 'profile_revision_1',
  workflowMode: 'flash-observe',
  manifestDigest: 'manifest_digest_1',
  firmware: {
    mainOwnedSourceRef: 'mainOwnedSourceRef:C:/secret/build/app.bin',
    displayName: 'app.bin',
    contentSha256: 'a'.repeat(64),
    byteLength: 1024,
    format: 'bin',
    baseAddress: 0x08000000,
  },
  result: {
    flashed: true,
    verified: true,
    observationSucceeded: true,
  },
};

function matchingEvidence(
  overrides: Partial<VerifiedDeploymentEvidence> = {},
): VerifiedDeploymentEvidence {
  return {
    ...BASE_EVIDENCE,
    ...overrides,
    firmware: {
      ...BASE_EVIDENCE.firmware,
      ...overrides.firmware,
    },
    result: {
      ...BASE_EVIDENCE.result,
      ...overrides.result,
    },
  };
}

describe('CompensationCandidateService', () => {
  it('creates a display-safe known-good summary only after flash, verify, and observation success', () => {
    const service = new CompensationCandidateService({
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      createCandidateId: () => 'candidate_1',
      ttlMs: 30 * 60 * 1000,
    });

    expect(service.recordDeployment(matchingEvidence({ result: { verified: false } }))).toBeNull();
    expect(service.summaries()).toEqual([]);

    const summary = service.recordDeployment(BASE_EVIDENCE);

    expect(summary).toMatchObject({
      schemaVersion: '1.0.0',
      candidateId: 'candidate_1',
      targetLabel: 'STM32H743II',
      firmware: {
        displayName: 'app.bin',
        hashSha256Prefix: 'aaaaaaaaaaaaaaaa',
        byteLength: 1024,
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:30:00.000Z',
      eligibility: { status: 'available' },
      actionCode: 'compensation.reflash.review',
    });
    expect(JSON.stringify(summary)).not.toContain('mainOwnedSourceRef');
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(JSON.stringify(summary)).not.toContain('rollback');
  });

  it('preserves the previous known-good candidate when a later deployment fails or is unknown', () => {
    const service = new CompensationCandidateService({
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      createCandidateId: () => 'candidate_1',
    });
    const first = service.recordDeployment(BASE_EVIDENCE);

    service.recordDeployment(
      matchingEvidence({
        sourceOperationId: 'operation_failed',
        targetBindingDigest: 'target_digest_2',
        result: { flashed: true, verified: false, observationSucceeded: false },
        firmware: { contentSha256: 'b'.repeat(64) },
      }),
    );

    expect(service.summaries({ currentEvidence: BASE_EVIDENCE })).toEqual([first]);
  });

  it('marks summaries hidden when expired and disabled when current evidence no longer matches', () => {
    let now = new Date('2026-07-14T00:00:00.000Z');
    const service = new CompensationCandidateService({
      now: () => now,
      createCandidateId: () => 'candidate_1',
      ttlMs: 1_000,
    });
    service.recordDeployment(BASE_EVIDENCE);

    expect(service.summaries({ currentEvidence: matchingEvidence() })[0]).toMatchObject({
      eligibility: { status: 'available' },
    });
    expect(
      service.summaries({
        currentEvidence: matchingEvidence({ firmware: { contentSha256: 'b'.repeat(64) } }),
      })[0],
    ).toMatchObject({
      eligibility: {
        status: 'disabled',
        reasonCode: 'compensation.reflash.evidence_mismatch',
      },
    });

    now = new Date('2026-07-14T00:00:02.000Z');
    expect(service.summaries({ currentEvidence: matchingEvidence() })[0]).toMatchObject({
      eligibility: {
        status: 'hidden',
        reasonCode: 'compensation.reflash.expired',
      },
    });
  });

  it('clears Main-only candidates on shutdown without exporting internal refs', () => {
    const service = new CompensationCandidateService({
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      createCandidateId: () => 'candidate_1',
    });
    service.recordDeployment(BASE_EVIDENCE);

    expect(service.summaries()).toEqual([
      expect.objectContaining({
        eligibility: {
          status: 'disabled',
          reasonCode: 'compensation.reflash.evidence_mismatch',
        },
      }),
    ]);
    expect(service.summaries({ currentEvidence: BASE_EVIDENCE })).toHaveLength(1);
    service.clear();
    expect(service.summaries()).toEqual([]);
    expect(service.debugCandidateCount()).toBe(0);
  });

  it('projects profile suggestions from verified success without auto-saving or proving identity', () => {
    const service = new CompensationCandidateService({
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      createCandidateId: () => 'candidate_1',
    });

    expect(service.profileSuggestions()).toEqual([]);
    service.recordDeployment(BASE_EVIDENCE);

    const suggestions = service.profileSuggestions();

    expect(suggestions).toEqual([
      expect.objectContaining({
        schemaVersion: '1.0.0',
        suggestionId: 'profile_suggestion_candidate_1',
        profileLabel: 'STM32H743II',
        provenance: 'verified-jlink-rtt-success',
        saveActionCode: 'profile.suggestion.save',
        skipActionCode: 'profile.suggestion.skip',
      }),
    ]);
    expect(suggestions[0]?.fields).toEqual(
      expect.arrayContaining([
        { code: 'profile.target', label: 'STM32H743II' },
        { code: 'profile.firmware', label: 'app.bin' },
        { code: 'profile.workflow', label: 'flash-observe' },
      ]),
    );
    expect(JSON.stringify(suggestions)).not.toContain('mainOwnedSourceRef');
    expect(JSON.stringify(suggestions)).not.toContain('secret');
    expect(JSON.stringify(suggestions)).not.toContain('stable identity');
  });

  it('keeps reflash and profile-save execution facts Main-only behind display ids', () => {
    const service = new CompensationCandidateService({
      now: () => new Date('2026-07-14T00:00:00.000Z'),
      createCandidateId: () => 'candidate_1',
      ttlMs: 30 * 60 * 1000,
    });
    service.recordDeployment(BASE_EVIDENCE);

    expect(service.reflashRequest('candidate_1')).toBeNull();
    expect(service.reflashRequest('candidate_1', { currentEvidence: matchingEvidence() })).toEqual({
      root: 'C:/repo',
    });
    expect(
      service.reflashRequest('candidate_1', {
        currentEvidence: matchingEvidence({ firmware: { contentSha256: 'b'.repeat(64) } }),
      }),
    ).toBeNull();
    expect(service.reflashRequest('unknown_candidate')).toBeNull();

    expect(service.profileSuggestionSave('profile_suggestion_candidate_1')).toEqual({
      root: 'C:/repo',
      label: 'STM32H743II',
      profile: BASE_EVIDENCE.workspace.profile,
    });
    expect(service.profileSuggestionSave('profile_suggestion_unknown')).toBeNull();
  });
});
