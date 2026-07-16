import type { SerialPortInfo } from '../../shared/types.js';
import {
  DeviceCandidateSchema,
  type DeviceCandidate,
  type ReadinessEvidence,
} from '../../shared/readiness-contract.js';

export interface SavedSerialProfileHint {
  readonly id: string;
  readonly label: string;
  readonly portLabel?: string;
  readonly baudRate?: number;
  readonly vendorId?: string;
  readonly productId?: string;
  readonly serialNumber?: string;
}

export interface DeviceCandidateResolverInput {
  readonly serialPorts: readonly SerialPortInfo[];
  readonly savedProfiles: readonly SavedSerialProfileHint[];
}

export function resolveDeviceCandidates(input: DeviceCandidateResolverInput): readonly DeviceCandidate[] {
  const identityCounts = countWeakIdentities(input.serialPorts);
  return Object.freeze(
    input.serialPorts.map((port) =>
      DeviceCandidateSchema.parse(buildSerialCandidate(port, input.savedProfiles, identityCounts)),
    ),
  );
}

function buildSerialCandidate(
  port: SerialPortInfo,
  savedProfiles: readonly SavedSerialProfileHint[],
  identityCounts: ReadonlyMap<string, number>,
): DeviceCandidate {
  const portLabel = safePortLabel(port.path);
  const matchingProfile = findStableProfileMatch(port, savedProfiles);
  const conflicts = matchingProfile?.portLabel !== undefined && matchingProfile.portLabel !== portLabel;
  const ambiguousIdentity = weakIdentityKey(port) !== undefined && identityCounts.get(weakIdentityKey(port) ?? '') !== 1;
  const confidence: DeviceCandidate['confidence'] =
    matchingProfile !== undefined && !conflicts
      ? 'exact'
      : ambiguousIdentity
        ? 'unknown'
        : 'likely';

  const evidence: ReadinessEvidence[] = [
    {
      source: 'live-discovery',
      summaryCode: 'readiness.serial.detected',
      params: [
        { key: 'port', value: portLabel },
        ...(port.friendlyName !== undefined && safeFriendlyName(port.friendlyName) !== portLabel
          ? [{ key: 'name', value: safeFriendlyName(port.friendlyName) }]
          : []),
      ],
    },
  ];

  if (matchingProfile !== undefined) {
    evidence.push({
      source: 'saved-record',
      summaryCode: 'readiness.profile.matched',
      params: [
        { key: 'profile', value: safeDisplayLabel(matchingProfile.label) },
        ...(matchingProfile.baudRate !== undefined
          ? [{ key: 'baudRate', value: String(matchingProfile.baudRate) }]
          : []),
      ],
    });
  }
  if (conflicts) {
    evidence.push({
      source: 'saved-record',
      summaryCode: 'readiness.profile.conflict',
      params: [
        { key: 'profilePort', value: safeDisplayLabel(matchingProfile.portLabel ?? 'saved') },
        { key: 'livePort', value: portLabel },
      ],
    });
  }

  const label =
    port.friendlyName !== undefined && safeFriendlyName(port.friendlyName) !== portLabel
      ? safeDisplayLabel(`${portLabel} · ${safeFriendlyName(port.friendlyName)}`)
      : portLabel;

  return {
    id: `candidate_serial_${safeIdSegment(port.path)}`,
    kind: 'serial',
    label,
    confidence,
    requiresUserConfirmation: confidence !== 'exact' || conflicts,
    evidence,
    serial: {
      portLabel,
      baudRate: matchingProfile?.baudRate ?? 115_200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
  };
}

function findStableProfileMatch(
  port: SerialPortInfo,
  savedProfiles: readonly SavedSerialProfileHint[],
): SavedSerialProfileHint | undefined {
  if (port.serialNumber === undefined || port.vendorId === undefined || port.productId === undefined) {
    return undefined;
  }
  return savedProfiles.find(
    (profile) =>
      profile.serialNumber === port.serialNumber &&
      profile.vendorId === port.vendorId &&
      profile.productId === port.productId,
  );
}

function countWeakIdentities(ports: readonly SerialPortInfo[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const port of ports) {
    const key = weakIdentityKey(port);
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function weakIdentityKey(port: SerialPortInfo): string | undefined {
  if (port.vendorId === undefined || port.productId === undefined) return undefined;
  return `${port.vendorId}:${port.productId}`;
}

function safePortLabel(path: string): string {
  const normalized = path.replace(/\\/gu, '/');
  const last = normalized.split('/').filter(Boolean).at(-1) ?? normalized;
  return safeDisplayLabel(last);
}

function safeFriendlyName(value: string): string {
  return safeDisplayLabel(value.replace(/\\/gu, '/').split('/').filter(Boolean).at(-1) ?? value);
}

function safeDisplayLabel(value: string): string {
  const trimmed = value.trim();
  const withoutControls = trimmed.replace(/\p{Cc}/gu, '').replace(/[\/\\]/gu, ' ');
  const collapsed = withoutControls.replace(/\s+/gu, ' ').trim();
  if (collapsed.length === 0 || collapsed === '.' || collapsed === '..') return 'device';
  if (/^[A-Za-z]:/u.test(collapsed)) return collapsed.slice(2).trim() || 'device';
  return collapsed.slice(0, 128);
}

function safeIdSegment(value: string): string {
  const sanitized = value.replace(/^[A-Za-z]:/u, '').replace(/[^A-Za-z0-9._:-]+/gu, '_');
  const trimmed = sanitized.replace(/^_+/u, '').replace(/_+$/u, '');
  return trimmed.length > 0 ? trimmed.slice(0, 96) : 'device';
}
