import type { ControlProfile } from './control-profile-types.js';
import type { IJLinkBackend, ProbeConnectOptions, ProbeInfo } from '../../jlink/types.js';
import { JLinkOperationError } from '../../jlink/errors.js';
import { ERROR_CODES } from '@linkterm/contracts/error-codes';
import { classifyJLinkTargetName } from '@linkterm/contracts/jlink-target-name';

/** J-Link auto speed candidates, tried from fastest to safer fallback. */
const AUTO_JLINK_SPEEDS_KHZ = [50_000, 25_000, 10_000, 8_000, 4_000, 1_000] as const;

export type SanitizedProbeInfo = Omit<ProbeInfo, 'serialNumber'>;

/** Raised when a control profile asks for chip connection but lacks required J-Link facts. */
export class ControlProfileChipConfigError extends Error {
  readonly code = ERROR_CODES.INVALID_ARGUMENT;

  constructor(message: string) {
    super(message);
    this.name = 'ControlProfileChipConfigError';
  }
}

/**
 * Connect the J-Link chip target described by a control profile.
 *
 * Returns undefined when profile.jlink.enabled is not true, matching activate_control_profile's
 * optional activation semantics.
 */
export async function connectControlProfileChip(
  profile: ControlProfile,
  jlinkBackend: IJLinkBackend,
): Promise<SanitizedProbeInfo | undefined> {
  if (profile.jlink?.enabled !== true) return undefined;
  const { target } = profile.jlink;
  if (target === undefined || target.trim().length === 0) {
    throw new ControlProfileChipConfigError(
      'jlink.enabled=true requires jlink.target in control-profile.json',
    );
  }

  const targetClassification = classifyJLinkTargetName(target);
  const opts: ProbeConnectOptions = { target: targetClassification.normalizedTarget };
  if (profile.jlink.interface !== undefined) opts.interface = profile.jlink.interface;
  const probe = await connectProbeWithConfiguredSpeed(jlinkBackend, opts, profile.jlink.speedKHz);
  return sanitizeProbeInfo(probe);
}

/**
 * Connect a probe using a configured speed. speedKHz='auto' falls back through known stable speeds.
 */
export async function connectProbeWithConfiguredSpeed(
  jlinkBackend: IJLinkBackend,
  baseOpts: ProbeConnectOptions,
  speedKHz: number | 'auto' | undefined,
): Promise<ProbeInfo> {
  if (speedKHz === undefined) return jlinkBackend.probeConnect(baseOpts);
  if (typeof speedKHz === 'number') {
    return jlinkBackend.probeConnect({ ...baseOpts, speedKHz });
  }

  let lastError: JLinkOperationError | undefined;
  for (const candidate of AUTO_JLINK_SPEEDS_KHZ) {
    try {
      return await jlinkBackend.probeConnect({ ...baseOpts, speedKHz: candidate });
    } catch (err) {
      if (!(err instanceof JLinkOperationError)) throw err;
      lastError = err;
    }
  }
  throw (
    lastError ??
    new JLinkOperationError('Unable to connect J-Link with auto speed', {
      operation: 'probeConnect',
    })
  );
}

/** Strip physical probe serial numbers at UI/MCP evidence boundaries. */
export function sanitizeProbeInfo(p: ProbeInfo): SanitizedProbeInfo {
  const { serialNumber: _serialNumber, ...rest } = p;
  void _serialNumber;
  return rest;
}
