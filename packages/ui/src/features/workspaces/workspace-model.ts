import type {
  SavedConnectionSummary,
  SavedControlProfileRecordPayload,
} from '@linkterm/contracts/preload-api';

export type WorkspaceKind = 'full' | 'serial-only';

export interface WorkspaceSummary {
  readonly id: string;
  readonly label: string;
  readonly kind: WorkspaceKind;
  readonly source: 'control-profile' | 'connection-profile';
  readonly details: readonly string[];
  readonly updatedAt: string;
  readonly controlProfileRecordId?: string;
  readonly connectionProfileId?: string;
}

export function summarizeControlProfileRecord(
  record: SavedControlProfileRecordPayload,
): WorkspaceSummary {
  const details: string[] = [];
  const { profile } = record;

  if (profile.serial?.enabled && profile.serial.port) {
    const baudRate = profile.serial.baudRate ?? 'baud unset';
    details.push(`${profile.serial.port} · ${baudRate}`);
  }
  if (profile.jlink?.enabled) {
    details.push(`J-Link${profile.jlink.target ? ` · ${profile.jlink.target}` : ''}`);
  }
  if (profile.rtt?.enabled) {
    const channels = profile.rtt.channels?.join(', ') ?? 'default';
    details.push(`RTT · ch${channels}`);
  }
  if (profile.flash?.binary) details.push(fileName(profile.flash.binary));

  return {
    id: record.id,
    label: record.label,
    kind: 'full',
    source: 'control-profile',
    details,
    updatedAt: record.updatedAt,
    controlProfileRecordId: record.id,
  };
}

export function summarizeSerialConnection(
  profile: SavedConnectionSummary,
): WorkspaceSummary | null {
  if (profile.config.type !== 'serial') return null;

  return {
    id: profile.id,
    label: profile.label,
    kind: 'serial-only',
    source: 'connection-profile',
    details: [`${profile.config.port} · ${profile.config.baudRate}`],
    updatedAt: profile.updatedAt,
    connectionProfileId: profile.id,
  };
}

function fileName(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}
