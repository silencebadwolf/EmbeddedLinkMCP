import { electron } from '../electron-runtime.js';
import { openRttLogSession } from '../../core/session/rtt-log-session-open.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import type { ControlProfile, ControlProfileManager } from '../../core/workspace/index.js';
import { JLinkError } from '../../jlink/errors.js';
import type { IJLinkBackend, ProbeConnectOptions, RttChannelInfo } from '../../jlink/types.js';
import { ERROR_CODES, type ErrorCode } from '../../shared/error-codes.js';
import { normalizeJLinkTargetName } from '../../shared/jlink-target-name.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  PreloadFail,
  PreloadResult,
  RttLogOpenRequestPayload,
  RttLogOpenSuccess,
} from '../../shared/preload-api.js';

const { ipcMain } = electron;

/** 注册 renderer 可调用的 RTT 日志会话 IPC handler。 */
export function registerRttLogSessionIpc(
  sessionManager: SessionManager,
  jlinkBackend: IJLinkBackend,
  controlProfileManager?: ControlProfileManager,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.RTT_LOG_OPEN,
    async (_event, raw: RttLogOpenRequestPayload): Promise<PreloadResult<RttLogOpenSuccess>> => {
      try {
        const input = normalizeRequest(raw);
        const target = await resolveRttTarget(input, jlinkBackend, controlProfileManager);
        const result = await openRttLogSession({
          sessionManager,
          jlinkBackend,
          probeId: target.probeId,
          channelIndex: target.channelIndex,
          pollIntervalMs: input.pollIntervalMs,
          maxBytesPerRead: input.maxBytesPerRead,
          label: input.label,
          createdBy: 'human',
        });
        return {
          success: true,
          data: {
            sessionId: result.session.id,
            state: result.session.state,
            reused: result.reused,
            probeId: target.probeId,
            channelIndex: target.channelIndex,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return failOf(errorCodeOf(err), message);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.RTT_LOG_OPEN);
  };
}

class InvalidRttLogOpenRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRttLogOpenRequestError';
  }
}

interface NormalizedRttLogOpenRequest {
  probeId?: string;
  root?: string;
  channelIndex: number;
  pollIntervalMs: number;
  maxBytesPerRead: number;
  label?: string;
}

interface ResolvedRttTarget {
  probeId: string;
  channelIndex: number;
}

function normalizeRequest(raw: RttLogOpenRequestPayload): NormalizedRttLogOpenRequest {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidRttLogOpenRequestError('probeId is required');
  }
  const probeId = typeof raw.probeId === 'string' ? raw.probeId.trim() : '';
  const root = typeof raw.root === 'string' ? raw.root.trim() : '';
  if (!probeId && !root) {
    throw new InvalidRttLogOpenRequestError('probeId or root is required');
  }
  return {
    ...(probeId ? { probeId } : {}),
    ...(root ? { root } : {}),
    channelIndex: normalizeInteger(raw.channelIndex, 0, 0, Number.MAX_SAFE_INTEGER, 'channelIndex'),
    pollIntervalMs: normalizeInteger(raw.pollIntervalMs, 100, 10, 10_000, 'pollIntervalMs'),
    maxBytesPerRead: normalizeInteger(raw.maxBytesPerRead, 4096, 1, 64 * 1024, 'maxBytesPerRead'),
    ...(raw.label !== undefined ? { label: raw.label } : {}),
  };
}

async function resolveRttTarget(
  input: NormalizedRttLogOpenRequest,
  jlinkBackend: IJLinkBackend,
  controlProfileManager: ControlProfileManager | undefined,
): Promise<ResolvedRttTarget> {
  if (input.probeId !== undefined) {
    return { probeId: input.probeId, channelIndex: input.channelIndex };
  }
  if (controlProfileManager === undefined) {
    throw new InvalidRttLogOpenRequestError('root-based RTT open requires a control profile manager');
  }
  if (input.root === undefined) {
    throw new InvalidRttLogOpenRequestError('root is required');
  }
  const profile = await controlProfileManager.load(input.root);
  if (profile.rtt?.enabled !== true) {
    throw new InvalidRttLogOpenRequestError('rtt.enabled=true is required in control-profile.json');
  }
  const probe = await jlinkBackend.probeConnect(buildProbeConnectOptions(profile));
  const rtt = await jlinkBackend.rttConnect(probe.probeId);
  return {
    probeId: probe.probeId,
    channelIndex: selectRttChannel(profile.rtt.channels, rtt.channels, input.channelIndex),
  };
}

function buildProbeConnectOptions(profile: ControlProfile): ProbeConnectOptions {
  if (profile.jlink?.enabled !== true || profile.jlink.target === undefined) {
    throw new InvalidRttLogOpenRequestError('jlink.enabled=true and jlink.target are required in control-profile.json');
  }
  const opts: ProbeConnectOptions = { target: normalizeJLinkTargetName(profile.jlink.target) };
  if (profile.jlink.interface !== undefined) opts.interface = profile.jlink.interface;
  if (typeof profile.jlink.speedKHz === 'number') opts.speedKHz = profile.jlink.speedKHz;
  return opts;
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

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new InvalidRttLogOpenRequestError(`${field} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function errorCodeOf(err: unknown): ErrorCode {
  if (err instanceof InvalidRttLogOpenRequestError) return ERROR_CODES.INVALID_ARGUMENT;
  if (err instanceof JLinkError) return err.code;
  return ERROR_CODES.INTERNAL;
}

function failOf(code: ErrorCode, message: string): PreloadFail {
  return { success: false, error: { code, message } };
}
