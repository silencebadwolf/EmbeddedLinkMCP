import type { IJLinkBackend } from '../../jlink/types.js';
import type { SessionManager } from './session-manager.js';
import { RttLogSession } from './rtt-log-session.js';

/** 打开 RTT 日志会话的依赖与参数。 */
export interface OpenRttLogSessionOptions {
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  probeId: string;
  channelIndex: number;
  pollIntervalMs: number;
  maxBytesPerRead: number;
  label?: string;
  createdBy?: 'human' | 'ai';
}

/** 打开或复用 RTT 日志会话的结果。 */
export interface OpenRttLogSessionResult {
  session: RttLogSession;
  reused: boolean;
}

/**
 * 打开或复用同一 probe/channel 的 RTT 日志会话。
 *
 * @param options 共享 SessionManager、J-Link backend 和 RTT 轮询参数
 * @returns 新建或复用的 RTT 日志会话
 */
export async function openRttLogSession(
  options: OpenRttLogSessionOptions,
): Promise<OpenRttLogSessionResult> {
  const existing = findActiveRttLogSession(
    options.sessionManager,
    options.probeId,
    options.channelIndex,
  );
  if (existing !== undefined) {
    return { session: existing, reused: true };
  }

  const session = options.sessionManager.create((id) => new RttLogSession({
    id,
    jlinkBackend: options.jlinkBackend,
    probeId: options.probeId,
    channelIndex: options.channelIndex,
    pollIntervalMs: options.pollIntervalMs,
    maxBytesPerRead: options.maxBytesPerRead,
  }), {
    connectionType: 'rtt-log',
    label: options.label ?? `RTT:${options.channelIndex}`,
    createdBy: options.createdBy,
    rttLog: {
      probeId: options.probeId,
      channelIndex: options.channelIndex,
    },
  }) as RttLogSession;
  try {
    await session.open();
  } catch (err) {
    await options.sessionManager.destroy(session.id);
    throw err;
  }
  return { session, reused: false };
}

function findActiveRttLogSession(
  sessionManager: SessionManager,
  probeId: string,
  channelIndex: number,
): RttLogSession | undefined {
  for (const summary of sessionManager.listSummaries()) {
    if (
      summary.connectionType === 'rtt-log' &&
      summary.rttLog?.probeId === probeId &&
      summary.rttLog.channelIndex === channelIndex &&
      (summary.state === 'idle' || summary.state === 'opening' || summary.state === 'open')
    ) {
      const session = sessionManager.get(summary.sessionId);
      if (session instanceof RttLogSession) return session;
    }
  }
  return undefined;
}
