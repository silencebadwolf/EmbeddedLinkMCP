import { ipcMain } from 'electron';
import { openRttLogSession } from '../../core/session/rtt-log-session-open.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import { JLinkError } from '../../jlink/errors.js';
import type { IJLinkBackend } from '../../jlink/types.js';
import { ERROR_CODES, type ErrorCode } from '../../shared/error-codes.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  PreloadFail,
  PreloadResult,
  RttLogOpenRequestPayload,
  RttLogOpenSuccess,
} from '../../shared/preload-api.js';

/** 注册 renderer 可调用的 RTT 日志会话 IPC handler。 */
export function registerRttLogSessionIpc(
  sessionManager: SessionManager,
  jlinkBackend: IJLinkBackend,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.RTT_LOG_OPEN,
    async (_event, raw: RttLogOpenRequestPayload): Promise<PreloadResult<RttLogOpenSuccess>> => {
      try {
        const input = normalizeRequest(raw);
        const result = await openRttLogSession({
          sessionManager,
          jlinkBackend,
          probeId: input.probeId,
          channelIndex: input.channelIndex,
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

function normalizeRequest(raw: RttLogOpenRequestPayload): Required<Omit<RttLogOpenRequestPayload, 'label'>> & { label?: string } {
  if (!raw || typeof raw.probeId !== 'string' || raw.probeId.trim() === '') {
    throw new InvalidRttLogOpenRequestError('probeId is required');
  }
  return {
    probeId: raw.probeId,
    channelIndex: normalizeInteger(raw.channelIndex, 0, 0, Number.MAX_SAFE_INTEGER, 'channelIndex'),
    pollIntervalMs: normalizeInteger(raw.pollIntervalMs, 100, 10, 10_000, 'pollIntervalMs'),
    maxBytesPerRead: normalizeInteger(raw.maxBytesPerRead, 4096, 1, 64 * 1024, 'maxBytesPerRead'),
    ...(raw.label !== undefined ? { label: raw.label } : {}),
  };
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
