import {
  defaultHostPathResolver,
  type ControlProfile,
  type ControlProfileManager,
  type HostPathResolver,
} from '../workspace/index.js';
import { JLinkOperationError } from '../../jlink/errors.js';
import type {
  GdbServerHandle,
  IJLinkBackend,
  ProbeConnectOptions,
  RttChannelInfo,
} from '../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../jlink/device-catalog.js';
import { resolveJLinkTarget, type JLinkTargetResolution } from '../../jlink/target-resolver.js';
import { normalizeJLinkTargetName } from '@linkterm/contracts/jlink-target-name';

/** profile/root based RTT log preparation dependencies. */
export interface PrepareProfileRttLogTargetDeps {
  controlProfileManager: ControlProfileManager;
  jlinkBackend: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  hostPathResolver?: HostPathResolver;
}

/** profile/root based RTT log preparation input. */
export interface PrepareProfileRttLogTargetInput {
  root: string;
  channelIndex: number;
}

/** Result of preparing the backend transport required by a continuous RTT log session. */
export interface PreparedProfileRttLogTarget {
  root: string;
  hostRoot: string;
  rootResolved: boolean;
  probeId: string;
  channelIndex: number;
  gdbServerStarted: true;
  gdbServer: GdbServerHandle;
  rttChannels: RttChannelInfo[];
  targetResolution: JLinkTargetResolution;
}

/** Invalid profile state for profile/root based RTT log observation. */
export class ProfileRttLogTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileRttLogTargetError';
  }
}

const AUTO_JLINK_SPEEDS_KHZ = [50_000, 25_000, 10_000, 8_000, 4_000, 1_000] as const;

/**
 * Prepare a workspace profile backed RTT log target.
 *
 * This is the high-level observation path: it owns J-Link connect, managed GDB server
 * startup, RTT connect, and channel selection before the caller opens the shared session.
 */
export async function prepareProfileRttLogTarget(
  input: PrepareProfileRttLogTargetInput,
  deps: PrepareProfileRttLogTargetDeps,
): Promise<PreparedProfileRttLogTarget> {
  const hostPathResolver = deps.hostPathResolver ?? defaultHostPathResolver;
  const hostRoot = await hostPathResolver.toHostPath(input.root);
  const profile = await deps.controlProfileManager.load(hostRoot);
  if (profile.rtt?.enabled !== true) {
    throw new ProfileRttLogTargetError('rtt.enabled=true is required in control-profile.json');
  }

  const baseOpts = buildProbeConnectOptions(profile);
  const targetResolution = await resolveJLinkTarget(baseOpts.target, deps.jlinkDeviceCatalog);
  const probe = await connectProbeWithConfiguredSpeed(
    deps.jlinkBackend,
    { ...baseOpts, target: targetResolution.target },
    profile.jlink?.speedKHz,
  );
  const gdbServer = await deps.jlinkBackend.gdbServerStart(probe.probeId);
  const controlBlockAddress = parseOptionalHexAddress(profile.rtt.controlBlockAddress);
  const rtt = controlBlockAddress === undefined
    ? await deps.jlinkBackend.rttConnect(probe.probeId)
    : await deps.jlinkBackend.rttConnect(probe.probeId, { controlBlockAddress });
  return {
    root: input.root,
    hostRoot,
    rootResolved: hostRoot !== input.root,
    probeId: probe.probeId,
    channelIndex: selectRttChannel(profile.rtt.channels, rtt.channels, input.channelIndex),
    gdbServerStarted: true,
    gdbServer,
    rttChannels: rtt.channels,
    targetResolution,
  };
}

function buildProbeConnectOptions(profile: ControlProfile): ProbeConnectOptions {
  if (profile.jlink?.enabled !== true || profile.jlink.target === undefined) {
    throw new ProfileRttLogTargetError(
      'jlink.enabled=true and jlink.target are required in control-profile.json',
    );
  }
  const opts: ProbeConnectOptions = { target: normalizeJLinkTargetName(profile.jlink.target) };
  if (profile.jlink.interface !== undefined) opts.interface = profile.jlink.interface;
  return opts;
}

async function connectProbeWithConfiguredSpeed(
  jlinkBackend: IJLinkBackend,
  baseOpts: ProbeConnectOptions,
  speedKHz: number | 'auto' | undefined,
) {
  if (speedKHz === undefined) return jlinkBackend.probeConnect(baseOpts);
  if (typeof speedKHz === 'number') return jlinkBackend.probeConnect({ ...baseOpts, speedKHz });

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

function selectRttChannel(
  configuredChannels: number[] | undefined,
  visibleChannels: RttChannelInfo[],
  fallback: number,
): number {
  const upChannels = visibleChannels.filter((channel) => channel.direction === 'up');
  if (configuredChannels !== undefined) {
    const configured = configuredChannels.find((index) =>
      upChannels.some((channel) => channel.index === index),
    );
    if (configured !== undefined) return configured;
  }
  return upChannels[0]?.index ?? fallback;
}

function parseOptionalHexAddress(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new ProfileRttLogTargetError(`Invalid RTT control block address: ${value}`);
  }
  return parsed;
}
