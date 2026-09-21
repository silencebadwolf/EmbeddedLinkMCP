import { openRttLogSession } from '@linkterm/runtime/core/session/rtt-log-session-open';
import {
  prepareProfileRttLogTarget,
  ProfileRttLogTargetError,
} from '@linkterm/runtime/core/session/rtt-log-profile-target';
import type { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import type { ControlProfileManager, HostPathResolver } from '@linkterm/runtime/core/workspace/index';
import { JLinkError } from '@linkterm/runtime/jlink/errors';
import type { IJLinkBackend } from '@linkterm/runtime/jlink/types';
import type { JLinkDeviceCatalog } from '@linkterm/runtime/jlink/device-catalog';
import { ERROR_CODES, type ErrorCode } from '@linkterm/contracts/error-codes';
import type {
  RttLogOpenRequestPayload,
  RttLogOpenSuccess,
} from '@linkterm/contracts/preload-api';

export interface RttLogOpenDeps {
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  controlProfileManager?: ControlProfileManager;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  hostPathResolver?: HostPathResolver;
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

export class InvalidRttLogOpenRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRttLogOpenRequestError';
  }
}

export async function openRttLogFromRequest(
  raw: RttLogOpenRequestPayload,
  deps: RttLogOpenDeps,
): Promise<RttLogOpenSuccess> {
  const input = normalizeRttLogOpenRequest(raw);
  const target = await resolveRttTarget(input, deps);
  const result = await openRttLogSession({
    sessionManager: deps.sessionManager,
    jlinkBackend: deps.jlinkBackend,
    probeId: target.probeId,
    channelIndex: target.channelIndex,
    pollIntervalMs: input.pollIntervalMs,
    maxBytesPerRead: input.maxBytesPerRead,
    label: input.label,
    createdBy: 'human',
  });
  return {
    sessionId: result.session.id,
    state: result.session.state,
    reused: result.reused,
    probeId: target.probeId,
    channelIndex: target.channelIndex,
  };
}

export function normalizeRttLogOpenRequest(
  raw: RttLogOpenRequestPayload,
): NormalizedRttLogOpenRequest {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidRttLogOpenRequestError('probeId or root is required');
  }
  const probeId = typeof raw.probeId === 'string' ? raw.probeId.trim() : '';
  const root = typeof raw.root === 'string' ? raw.root.trim() : '';
  if (!probeId && !root) {
    throw new InvalidRttLogOpenRequestError('probeId or root is required');
  }
  if (probeId && root) {
    throw new InvalidRttLogOpenRequestError('probeId and root are mutually exclusive');
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
  deps: RttLogOpenDeps,
): Promise<ResolvedRttTarget> {
  if (input.root !== undefined) {
    if (deps.controlProfileManager === undefined) {
      throw new InvalidRttLogOpenRequestError('root-based RTT open requires a control profile manager');
    }
    return prepareProfileRttLogTarget(
      { root: input.root, channelIndex: input.channelIndex },
      {
        controlProfileManager: deps.controlProfileManager,
        jlinkBackend: deps.jlinkBackend,
        jlinkDeviceCatalog: deps.jlinkDeviceCatalog,
        hostPathResolver: deps.hostPathResolver,
      },
    );
  }
  if (input.probeId === undefined) {
    throw new InvalidRttLogOpenRequestError('probeId is required');
  }
  return { probeId: input.probeId, channelIndex: input.channelIndex };
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

export function rttLogOpenErrorCodeOf(err: unknown): ErrorCode {
  if (err instanceof InvalidRttLogOpenRequestError) return ERROR_CODES.INVALID_ARGUMENT;
  if (err instanceof ProfileRttLogTargetError) return ERROR_CODES.INVALID_ARGUMENT;
  if (err instanceof JLinkError) return err.code;
  return ERROR_CODES.INTERNAL;
}
