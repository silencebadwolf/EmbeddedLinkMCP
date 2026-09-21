import type { NonSensitivePrefill } from './preload-api.js';
import {
  READINESS_SCHEMA_VERSION,
  SerialConnectionDraftSchema,
  type DeviceCandidate,
  type SerialConnectionDraft,
} from './readiness-contract.js';

export interface CreateDraftOptions {
  readonly draftId: string;
}

export interface ManualSerialDraftInput {
  readonly draftId: string;
  readonly portLabel: string;
  readonly baudRate?: number;
  readonly dataBits?: 5 | 6 | 7 | 8;
  readonly stopBits?: 1 | 1.5 | 2;
  readonly parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

type DraftSource = SerialConnectionDraft['source'];
type ParameterSource = SerialConnectionDraft['parameters']['baudRate']['source'];

export function createDraftFromCandidate(
  candidate: DeviceCandidate,
  options: CreateDraftOptions,
): SerialConnectionDraft {
  const source = sourceFromCandidate(candidate);
  const settings = candidate.serial;
  const baudRateSource = sourceForCandidateParameter(candidate, 'baudRate');
  const defaultSource = sourceForCandidateDefaults(candidate);
  return SerialConnectionDraftSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    draftId: options.draftId,
    source,
    candidateId: candidate.id,
    candidateFingerprint: fingerprintDeviceCandidate(candidate),
    ...(settings?.portLabel !== undefined ? { portLabel: settings.portLabel } : {}),
    parameters: {
      baudRate: { value: settings?.baudRate ?? 115_200, source: baudRateSource },
      dataBits: { value: settings?.dataBits ?? 8, source: defaultSource },
      stopBits: { value: settings?.stopBits ?? 1, source: defaultSource },
      parity: { value: settings?.parity ?? 'none', source: defaultSource },
    },
    sideEffects: defaultSerialSideEffects(),
    validation:
      settings === undefined
        ? { status: 'incomplete', reasons: ['readiness.serial.settings_missing'] }
        : { status: 'ready', reasons: [] },
  });
}

export function createManualSerialDraft(input: ManualSerialDraftInput): SerialConnectionDraft {
  const portLabel = input.portLabel.trim();
  return SerialConnectionDraftSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    draftId: input.draftId,
    source: 'manual',
    ...(portLabel.length > 0 ? { portLabel } : {}),
    parameters: {
      baudRate: { value: input.baudRate ?? 115_200, source: sourceFor(input.baudRate) },
      dataBits: { value: input.dataBits ?? 8, source: sourceFor(input.dataBits) },
      stopBits: { value: input.stopBits ?? 1, source: sourceFor(input.stopBits) },
      parity: { value: input.parity ?? 'none', source: sourceFor(input.parity) },
    },
    sideEffects: defaultSerialSideEffects(),
    validation:
      portLabel.length === 0
        ? { status: 'incomplete', reasons: ['readiness.serial.port_required'] }
        : { status: 'ready', reasons: [] },
  });
}

export function draftToNonSensitivePrefill(draft: SerialConnectionDraft): NonSensitivePrefill {
  return {
    type: 'serial',
    ...(draft.portLabel !== undefined ? { serialPort: draft.portLabel } : {}),
    baudRate: String(draft.parameters.baudRate.value),
    serialMode: 'terminal',
    dataBits: String(draft.parameters.dataBits.value) as NonSensitivePrefill['dataBits'],
    stopBits: String(draft.parameters.stopBits.value) as NonSensitivePrefill['stopBits'],
    parity: draft.parameters.parity.value,
    readinessDraftId: draft.draftId,
    readinessDraftSource: draft.source,
    ...(draft.candidateId !== undefined ? { readinessDraftCandidateId: draft.candidateId } : {}),
    readinessDraftValidationStatus: draft.validation.status,
    ...(draft.sideEffects.mayResetBoard !== undefined
      ? { readinessDraftMayResetBoard: draft.sideEffects.mayResetBoard }
      : {}),
    readinessDraftSendsPayloadOnConnect: draft.sideEffects.sendsPayloadOnConnect,
  };
}

export function fingerprintDeviceCandidate(candidate: DeviceCandidate): string {
  const fingerprintInput = JSON.stringify({
    id: candidate.id,
    kind: candidate.kind,
    label: candidate.label,
    confidence: candidate.confidence,
    requiresUserConfirmation: candidate.requiresUserConfirmation,
    evidence: candidate.evidence.map((item) => ({
      source: item.source,
      summaryCode: item.summaryCode,
      params: item.params?.map((param) => ({ key: param.key, value: param.value })) ?? [],
    })),
    serial: candidate.serial ?? null,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprintInput.length; index += 1) {
    hash ^= fingerprintInput.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `candidate_fp_${hash.toString(16).padStart(8, '0')}`;
}

function sourceFromCandidate(candidate: DeviceCandidate): DraftSource {
  switch (candidate.kind) {
    case 'saved-profile':
      return 'saved-profile';
    case 'reusable-session':
      return 'reusable-session';
    case 'manual':
      return 'manual';
    case 'serial':
    case 'jlink':
      return 'live-discovery';
  }
}

function sourceFor(value: unknown): ParameterSource {
  return value === undefined ? 'default' : 'manual';
}

function sourceForCandidateParameter(
  candidate: DeviceCandidate,
  parameter: 'baudRate',
): ParameterSource {
  if (candidate.kind === 'saved-profile') return 'saved-profile';
  if (candidate.kind === 'manual') return 'manual';
  if (candidate.kind === 'reusable-session') return 'reusable-session';
  const profileEvidence = candidate.evidence.some(
    (item) =>
      item.source === 'saved-record' &&
      item.params?.some((param) => param.key === parameter) === true,
  );
  return profileEvidence ? 'saved-profile' : 'default';
}

function sourceForCandidateDefaults(candidate: DeviceCandidate): ParameterSource {
  if (candidate.kind === 'saved-profile') return 'saved-profile';
  if (candidate.kind === 'manual') return 'manual';
  if (candidate.kind === 'reusable-session') return 'reusable-session';
  return 'default';
}

function defaultSerialSideEffects(): SerialConnectionDraft['sideEffects'] {
  return {
    reservesPort: true,
    sendsPayloadOnConnect: false,
    controlLineBehaviorCode: 'connection.control_lines.default',
    mayResetBoard: true,
  };
}
