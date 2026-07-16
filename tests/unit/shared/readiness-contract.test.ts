import { describe, expect, it } from 'vitest';
import {
  READINESS_MAX_CHECKS,
  READINESS_MAX_CANDIDATES,
  READINESS_MAX_DIAGNOSTICS,
  READINESS_MAX_EVIDENCE_REFS,
  READINESS_MAX_LABEL_LENGTH,
  READINESS_MAX_PARAMS,
  READINESS_MAX_RECENT_ITEMS,
  READINESS_SCHEMA_VERSION,
  DeviceCandidateSchema,
  ReadinessActionSchema,
  ReadinessCheckSchema,
  ReadinessDiagnosticSchema,
  ReadinessEvidenceSchema,
  ReadinessEventSchema,
  ReadinessFailureResultSchema,
  ReadinessPreferencesSchema,
  ReadinessRefreshResultSchema,
  ReadinessScopeSchema,
  ReadinessSeveritySchema,
  ReadinessStatusSchema,
  RuntimeReadinessSnapshotSchema,
  SafeReadinessCodeSchema,
  SafeReadinessLabelSchema,
  CompensationCandidateSummarySchema,
  JLinkRttDownloadObserveDraftSchema,
  ProfileSuggestionSummarySchema,
  SerialConnectionDraftSchema,
} from '@/shared/readiness-contract.js';

function expectRejected(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

const CHECKED_AT = '2026-07-13T00:00:00.000Z';

const evidence = {
  source: 'live-discovery',
  summaryCode: 'readiness.serial.detected',
  params: [{ key: 'port', value: 'COM7' }],
} as const;

const runtimeCheck = {
  id: 'runtime',
  scope: 'runtime',
  status: 'ready',
  severity: 'info',
  summaryCode: 'readiness.runtime.ready',
  evidence: [evidence],
  recommendedActions: [],
  checkedAt: CHECKED_AT,
} as const;

const candidate = {
  id: 'candidate_serial_COM7',
  kind: 'serial',
  label: 'COM7 · USB Serial Device',
  confidence: 'likely',
  requiresUserConfirmation: true,
  evidence: [evidence],
  serial: {
    portLabel: 'COM7',
    baudRate: 115_200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  },
} as const;

const draft = {
  schemaVersion: READINESS_SCHEMA_VERSION,
  draftId: 'draft_1',
  source: 'live-discovery',
  candidateId: 'candidate_serial_COM7',
  portLabel: 'COM7',
  parameters: {
    baudRate: { value: 115_200, source: 'default' },
    dataBits: { value: 8, source: 'default' },
    stopBits: { value: 1, source: 'default' },
    parity: { value: 'none', source: 'default' },
  },
  sideEffects: {
    reservesPort: true,
    sendsPayloadOnConnect: false,
    controlLineBehaviorCode: 'connection.control_lines.default',
    mayResetBoard: true,
  },
  validation: {
    status: 'ready',
    reasons: [],
  },
} as const;

function snapshot() {
  return {
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: 'snapshot_1',
    generation: 1,
    status: 'ready',
    generatedAt: CHECKED_AT,
    checks: [runtimeCheck],
    deviceCandidates: [candidate],
    reusableSessions: [
      {
        id: 'session_1',
        label: 'serial COM7',
        kind: 'serial',
      },
    ],
    reusableProfiles: [
      {
        id: 'profile_1',
        label: 'board-a',
        kind: 'control-profile',
      },
    ],
    blockers: [],
    diagnostics: [],
  } as const;
}

describe('runtime readiness display contract', () => {
  it('exports fixed schema version, enums, and bounds', () => {
    expect(READINESS_SCHEMA_VERSION).toBe('1.0.0');
    expect(ReadinessStatusSchema.options).toEqual([
      'unknown',
      'checking',
      'ready',
      'action-required',
      'blocked',
      'unavailable',
    ]);
    expect(ReadinessScopeSchema.options).toEqual([
      'runtime',
      'workspace',
      'serial',
      'jlink',
      'firmware',
      'rtt',
      'profile',
      'session',
      'agent',
    ]);
    expect(ReadinessSeveritySchema.options).toEqual(['info', 'warning', 'error']);
    expect({
      READINESS_MAX_LABEL_LENGTH,
      READINESS_MAX_PARAMS,
      READINESS_MAX_EVIDENCE_REFS,
      READINESS_MAX_CHECKS,
      READINESS_MAX_CANDIDATES,
      READINESS_MAX_RECENT_ITEMS,
      READINESS_MAX_DIAGNOSTICS,
    }).toEqual({
      READINESS_MAX_LABEL_LENGTH: 128,
      READINESS_MAX_PARAMS: 12,
      READINESS_MAX_EVIDENCE_REFS: 8,
      READINESS_MAX_CHECKS: 64,
      READINESS_MAX_CANDIDATES: 128,
      READINESS_MAX_RECENT_ITEMS: 32,
      READINESS_MAX_DIAGNOSTICS: 32,
    });
  });

  it('accepts safe checks, evidence, actions, diagnostics, candidates, drafts, and snapshots', () => {
    expect(ReadinessEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(ReadinessActionSchema.parse({ kind: 'refresh', code: 'readiness.refresh' })).toEqual({
      kind: 'refresh',
      code: 'readiness.refresh',
    });
    expect(ReadinessCheckSchema.parse(runtimeCheck)).toEqual(runtimeCheck);
    expect(
      ReadinessDiagnosticSchema.parse({
        code: 'readiness.provider_timeout',
        severity: 'warning',
        checkedAt: CHECKED_AT,
      }),
    ).toEqual({
      code: 'readiness.provider_timeout',
      severity: 'warning',
      checkedAt: CHECKED_AT,
    });
    expect(DeviceCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(SerialConnectionDraftSchema.parse(draft)).toEqual(draft);
    expect(RuntimeReadinessSnapshotSchema.parse(snapshot())).toEqual(snapshot());
  });

  it('rejects unknown keys throughout the snapshot and nested DTOs', () => {
    expectRejected(ReadinessEvidenceSchema, { ...evidence, rawPath: 'C:/secret' });
    expectRejected(ReadinessActionSchema, {
      kind: 'refresh',
      code: 'readiness.refresh',
      handler: 'invokeRaw',
    });
    expectRejected(ReadinessCheckSchema, { ...runtimeCheck, rawError: 'stack' });
    expectRejected(DeviceCandidateSchema, { ...candidate, rawPort: { path: 'COM7' } });
    expectRejected(SerialConnectionDraftSchema, {
      ...draft,
      sideEffects: { ...draft.sideEffects, hiddenToggle: true },
    });
    expectRejected(RuntimeReadinessSnapshotSchema, {
      ...snapshot(),
      providerObjects: [{ secret: true }],
    });
  });

  it('rejects path-like labels, control characters, unsafe codes, and secret-like params', () => {
    for (const value of [
      String.raw`C:\Users\Admin\secret.pem`,
      'C:secret.pem',
      '/home/alice/.ssh/id_rsa',
      String.raw`\\server\share\secret.bin`,
      'nested/file.bin',
      String.raw`nested\file.bin`,
      '.',
      '..',
      'secret\u0000.pem',
      'secret\n.pem',
      'secret\u007f.pem',
    ]) {
      expectRejected(SafeReadinessLabelSchema, value);
    }

    expect(SafeReadinessLabelSchema.parse('COM7 · USB Serial Device')).toBe(
      'COM7 · USB Serial Device',
    );
    expect(SafeReadinessCodeSchema.parse('readiness.serial.detected')).toBe(
      'readiness.serial.detected',
    );
    expectRejected(SafeReadinessCodeSchema, 'bad code');
    expectRejected(ReadinessEvidenceSchema, {
      ...evidence,
      params: [{ key: 'token', value: 'abc123' }],
    });
    expectRejected(ReadinessEvidenceSchema, {
      ...evidence,
      params: [{ key: 'workspace', value: 'C:/Users/Admin/private' }],
    });
  });

  it('enforces generation, timestamp, serial settings, and list bounds', () => {
    expectRejected(RuntimeReadinessSnapshotSchema, { ...snapshot(), generation: -1 });
    expectRejected(RuntimeReadinessSnapshotSchema, { ...snapshot(), generation: 0.5 });
    expectRejected(RuntimeReadinessSnapshotSchema, {
      ...snapshot(),
      generatedAt: '2026-07-13T00:00:00.000',
    });
    expectRejected(DeviceCandidateSchema, {
      ...candidate,
      serial: { ...candidate.serial, baudRate: 0 },
    });
    expectRejected(DeviceCandidateSchema, {
      ...candidate,
      serial: { ...candidate.serial, dataBits: 9 },
    });
    expectRejected(SerialConnectionDraftSchema, {
      ...draft,
      parameters: { ...draft.parameters, parity: { value: 'secret', source: 'manual' } },
    });
    expectRejected(RuntimeReadinessSnapshotSchema, {
      ...snapshot(),
      checks: Array.from({ length: READINESS_MAX_CHECKS + 1 }, (_, index) => ({
        ...runtimeCheck,
        id: `runtime_${index}`,
      })),
    });
    expectRejected(RuntimeReadinessSnapshotSchema, {
      ...snapshot(),
      deviceCandidates: Array.from({ length: READINESS_MAX_CANDIDATES + 1 }, (_, index) => ({
        ...candidate,
        id: `candidate_${index}`,
      })),
    });
    expectRejected(RuntimeReadinessSnapshotSchema, {
      ...snapshot(),
      diagnostics: Array.from({ length: READINESS_MAX_DIAGNOSTICS + 1 }, (_, index) => ({
        code: `readiness.diag_${index}`,
        severity: 'warning',
        checkedAt: CHECKED_AT,
      })),
    });
  });

  it('parses versioned readiness preferences as safe hints only', () => {
    const preferences = {
      schemaVersion: READINESS_SCHEMA_VERSION,
      recentWorkspaces: [{ id: 'workspace_1', label: 'board-a' }],
      recentProfiles: [{ id: 'profile_1', label: 'board-a', kind: 'control-profile' }],
      dismissedHints: ['hint_manual_serial'],
    } as const;

    expect(ReadinessPreferencesSchema.parse(preferences)).toEqual(preferences);
    expectRejected(ReadinessPreferencesSchema, { ...preferences, schemaVersion: '2.0.0' });
    expectRejected(ReadinessPreferencesSchema, {
      ...preferences,
      recentWorkspaces: Array.from({ length: READINESS_MAX_RECENT_ITEMS + 1 }, (_, index) => ({
        id: `workspace_${index}`,
        label: `workspace ${index}`,
      })),
    });
    expectRejected(ReadinessPreferencesSchema, {
      ...preferences,
      recentWorkspaces: [{ id: 'workspace_1', label: 'C:/Users/Admin/private' }],
    });
    expectRejected(ReadinessPreferencesSchema, {
      ...preferences,
      credential: 'secret',
    });
  });

  it('parses readiness event and result envelopes without raw error messages', () => {
    expect(ReadinessEventSchema.parse({ schemaVersion: READINESS_SCHEMA_VERSION, snapshot: snapshot() }))
      .toMatchObject({
        schemaVersion: READINESS_SCHEMA_VERSION,
        snapshot: { snapshotId: 'snapshot_1' },
      });

    expect(ReadinessRefreshResultSchema.parse({ success: true, data: snapshot() })).toMatchObject({
      success: true,
      data: { snapshotId: 'snapshot_1' },
    });
    expect(
      ReadinessFailureResultSchema.parse({
        success: false,
        error: { code: 'INVALID_READINESS_PAYLOAD', message: 'Invalid readiness payload' },
      }),
    ).toEqual({
      success: false,
      error: { code: 'INVALID_READINESS_PAYLOAD', message: 'Invalid readiness payload' },
    });
    expectRejected(ReadinessFailureResultSchema, {
      success: false,
      error: { code: 'INVALID_READINESS_PAYLOAD', message: 'token=secret C:/private' },
    });
  });

  it('accepts Phase 6 J-Link, firmware, and RTT readiness evidence and actions', () => {
    expect(
      ReadinessEvidenceSchema.parse({
        source: 'jlink-backend',
        summaryCode: 'readiness.jlink.backend.available',
        params: [{ key: 'backend', value: 'J-Link backend available' }],
      }),
    ).toMatchObject({ source: 'jlink-backend' });
    expect(
      ReadinessEvidenceSchema.parse({
        source: 'probe-detect',
        summaryCode: 'readiness.jlink.probe.detected',
        params: [{ key: 'probe', value: 'J-Link probe A' }],
      }),
    ).toMatchObject({ source: 'probe-detect' });
    expect(
      ReadinessEvidenceSchema.parse({
        source: 'device-catalog',
        summaryCode: 'readiness.jlink.target.catalog.hit',
        params: [{ key: 'target', value: 'STM32H743' }],
      }),
    ).toMatchObject({ source: 'device-catalog' });
    expect(
      ReadinessEvidenceSchema.parse({
        source: 'firmware-metadata',
        summaryCode: 'readiness.firmware.hash.ready',
        params: [{ key: 'firmware', value: 'app.bin' }],
      }),
    ).toMatchObject({ source: 'firmware-metadata' });
    expect(
      ReadinessEvidenceSchema.parse({
        source: 'rtt-config',
        summaryCode: 'readiness.rtt.channel.ready',
        params: [{ key: 'channel', value: 'RTT up 0' }],
      }),
    ).toMatchObject({ source: 'rtt-config' });
    expect(
      ReadinessActionSchema.parse({
        kind: 'review-download-plan',
        code: 'readiness.jlink.review_download_plan',
      }),
    ).toEqual({
      kind: 'review-download-plan',
      code: 'readiness.jlink.review_download_plan',
    });
    expect(
      ReadinessActionSchema.parse({
        kind: 'open-rtt-log-session',
        code: 'readiness.rtt.open_log_session',
      }),
    ).toEqual({
      kind: 'open-rtt-log-session',
      code: 'readiness.rtt.open_log_session',
    });
  });

  it('parses display-safe J-Link candidates without probe serial numbers or private paths', () => {
    const jlinkCandidate = {
      id: 'candidate_jlink_probe_a',
      kind: 'jlink',
      label: 'J-Link probe A · STM32H743',
      confidence: 'likely',
      requiresUserConfirmation: true,
      evidence: [
        {
          source: 'probe-detect',
          summaryCode: 'readiness.jlink.probe.detected',
          params: [{ key: 'probe', value: 'J-Link probe A' }],
        },
      ],
      jlink: {
        probeLabel: 'J-Link probe A',
        targetLabel: 'STM32H743',
        interface: 'swd',
        speedKHz: 4000,
      },
    } as const;

    expect(DeviceCandidateSchema.parse(jlinkCandidate)).toEqual(jlinkCandidate);
    expectRejected(DeviceCandidateSchema, {
      ...jlinkCandidate,
      jlink: {
        ...jlinkCandidate.jlink,
        serialNumber: '123456789',
      },
    });
    expectRejected(DeviceCandidateSchema, {
      ...jlinkCandidate,
      jlink: {
        ...jlinkCandidate.jlink,
        targetLabel: String.raw`C:\Users\Admin\firmware\secret.bin`,
      },
    });
  });

  it('parses Phase 6 download-and-observe drafts as provenance, not authorization', () => {
    const jlinkDraft = {
      schemaVersion: READINESS_SCHEMA_VERSION,
      draftId: 'draft_jlink_1',
      source: 'control-profile',
      candidateId: 'candidate_jlink_probe_a',
      workspaceLabel: 'lab-workspace',
      profile: {
        id: 'profile_1',
        label: 'stm32-lab',
        revision: 7,
      },
      target: {
        targetLabel: 'STM32H743',
        interface: 'swd',
        speedKHz: 4000,
        source: 'control-profile',
      },
      firmware: {
        displayName: 'app.bin',
        hashSha256Prefix: '0123abcd',
        byteLength: 65536,
        format: 'bin',
        baseAddress: 0x08000000,
        verify: true,
        source: 'control-profile',
      },
      rtt: {
        channelIndex: 0,
        maxBytes: 4096,
        timeoutMs: 15000,
        markers: ['ready', 'boot'],
        source: 'control-profile',
      },
      observationMode: 'rtt',
      sideEffects: {
        connectProbe: true,
        flashFirmware: true,
        resetTarget: true,
        startsGdbServer: true,
        connectsRtt: true,
      },
      validation: {
        status: 'ready',
        reasons: [],
      },
    } as const;

    expect(JLinkRttDownloadObserveDraftSchema.parse(jlinkDraft)).toEqual(jlinkDraft);
    expectRejected(JLinkRttDownloadObserveDraftSchema, { ...jlinkDraft, approvalId: 'approval_1' });
    expectRejected(JLinkRttDownloadObserveDraftSchema, { ...jlinkDraft, effectFingerprint: 'abc' });
    expectRejected(JLinkRttDownloadObserveDraftSchema, {
      ...jlinkDraft,
      firmware: { ...jlinkDraft.firmware, bytesBase64: 'AAAA' },
    });
    expectRejected(JLinkRttDownloadObserveDraftSchema, {
      ...jlinkDraft,
      firmware: { ...jlinkDraft.firmware, displayName: String.raw`C:\private\app.bin` },
    });
    expectRejected(JLinkRttDownloadObserveDraftSchema, {
      ...jlinkDraft,
      target: { ...jlinkDraft.target, probeSerialNumber: '123456789' },
    });
  });

  it('parses known-good compensation summaries without rollback-capable fields', () => {
    const summary = {
      schemaVersion: READINESS_SCHEMA_VERSION,
      candidateId: 'known_good_1',
      targetLabel: 'STM32H743',
      firmware: {
        displayName: 'app.bin',
        hashSha256Prefix: '0123abcd',
        byteLength: 65536,
      },
      createdAt: CHECKED_AT,
      eligibility: {
        status: 'available',
      },
      actionCode: 'compensation.reflash.review',
    } as const;

    expect(CompensationCandidateSummarySchema.parse(summary)).toEqual(summary);
    expectRejected(CompensationCandidateSummarySchema, { ...summary, rollbackToken: 'secret' });
    expectRejected(CompensationCandidateSummarySchema, { ...summary, preparedOperationId: 'prep_1' });
    expectRejected(CompensationCandidateSummarySchema, {
      ...summary,
      firmware: { ...summary.firmware, fullPath: String.raw`C:\private\app.bin` },
    });
    expectRejected(CompensationCandidateSummarySchema, {
      ...summary,
      eligibility: { status: 'disabled' },
    });
  });

  it('parses profile suggestions as user-confirmed safe hints only', () => {
    const suggestion = {
      schemaVersion: READINESS_SCHEMA_VERSION,
      suggestionId: 'profile_suggestion_1',
      profileLabel: 'stm32-lab',
      provenance: 'verified-jlink-rtt-success',
      fields: [
        { code: 'profile.field.target', label: 'STM32H743' },
        { code: 'profile.field.rtt', label: 'RTT up 0' },
      ],
      saveActionCode: 'profile.suggestion.save',
      skipActionCode: 'profile.suggestion.skip',
    } as const;

    expect(ProfileSuggestionSummarySchema.parse(suggestion)).toEqual(suggestion);
    expectRejected(ProfileSuggestionSummarySchema, { ...suggestion, autoSave: true });
    expectRejected(ProfileSuggestionSummarySchema, { ...suggestion, approvalId: 'approval_1' });
    expectRejected(ProfileSuggestionSummarySchema, {
      ...suggestion,
      fields: [{ code: 'profile.field.path', label: String.raw`C:\private\app.bin` }],
    });
  });

  it('freezes parsed nested DTOs and detaches them from mutable inputs', () => {
    const mutable = structuredClone(snapshot());
    const parsed = RuntimeReadinessSnapshotSchema.parse(mutable);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.checks)).toBe(true);
    expect(Object.isFrozen(parsed.checks[0])).toBe(true);
    expect(Object.isFrozen(parsed.checks[0]?.evidence)).toBe(true);
    expect(Object.isFrozen(parsed.deviceCandidates)).toBe(true);
    expect(Object.isFrozen(parsed.deviceCandidates[0])).toBe(true);
    expect(Object.isFrozen(parsed.reusableProfiles)).toBe(true);

    const serialized = JSON.stringify(parsed);
    expect(() => {
      (parsed.checks as unknown as Array<unknown>).push(runtimeCheck);
    }).toThrow(TypeError);
    expect(() => {
      (parsed.deviceCandidates[0] as { label: string }).label = 'changed';
    }).toThrow(TypeError);

    mutable.checks[0].summaryCode = 'readiness.changed';
    mutable.deviceCandidates[0].label = 'changed';
    expect(JSON.stringify(parsed)).toBe(serialized);
  });
});
