import {
  JLinkRttDownloadObserveDraftSchema,
  READINESS_SCHEMA_VERSION,
  type DeviceCandidate,
  type JLinkRttDownloadObserveDraft,
} from './readiness-contract.js';

export interface CreateJLinkRttDraftOptions {
  readonly draftId: string;
}

export function createJLinkRttDraftFromCandidate(
  candidate: DeviceCandidate,
  options: CreateJLinkRttDraftOptions,
): JLinkRttDownloadObserveDraft {
  const targetLabel = candidate.jlink?.targetLabel ?? candidate.label;
  return JLinkRttDownloadObserveDraftSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    draftId: options.draftId,
    source: 'live-discovery',
    candidateId: candidate.id,
    target: {
      targetLabel,
      interface: candidate.jlink?.interface ?? 'unknown',
      speedKHz: candidate.jlink?.speedKHz ?? 4000,
      source: candidate.jlink === undefined ? 'default' : 'live-discovery',
    },
    firmware: {
      displayName: 'Select firmware',
      byteLength: 0,
      format: 'unknown',
      baseAddress: 0,
      verify: true,
      source: 'manual',
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
      status: 'incomplete',
      reasons: [
        'readiness.workspace.profile_required',
        'readiness.firmware.missing',
        'readiness.rtt.config_missing',
      ],
    },
  });
}
