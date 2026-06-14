import type { SessionManager } from '../../core/session/session-manager.js';
import { buildSession } from '../../core/session/factory.js';
import type { SessionId, SessionState } from '../../shared/types.js';
import type { SessionCreateRequestConfig } from '../../shared/preload-api.js';

/**
 * Create a session and attempt to open it while preserving UI semantics:
 * transport open failures leave an errored session in the manager and still return success data.
 */
export async function createAndOpenSession(
  sessionManager: SessionManager,
  config: SessionCreateRequestConfig,
): Promise<{ sessionId: SessionId; state: SessionState }> {
  const session = sessionManager.create((id) => buildSession(id, config));
  try {
    await session.open();
  } catch {
    // SessionBase has already transitioned to errored; UI needs the tab metadata.
  }
  return { sessionId: session.id, state: session.state };
}
