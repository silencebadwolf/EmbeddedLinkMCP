import type { SessionManager } from '../../core/session/session-manager.js';
import { buildSession } from '../../core/session/factory.js';
import type { SessionId, SessionState } from '../../shared/types.js';
import type { SessionCreateRequestConfig } from '../../shared/preload-api.js';

/**
 * Create a session and attempt to open it while preserving UI semantics.
 *
 * Transport open failures leave an errored session in the manager and still return success data.
 *
 * @param sessionManager Shared runtime session manager.
 * @param config Sanitized session creation config.
 * @param labelOverride Optional non-sensitive UI label, used when config.label is absent.
 * @returns Created session id and final state.
 */
export async function createAndOpenSession(
  sessionManager: SessionManager,
  config: SessionCreateRequestConfig,
  labelOverride?: string,
): Promise<{ sessionId: SessionId; state: SessionState }> {
  const session = sessionManager.create((id) => buildSession(id, config), {
    connectionType: config.type,
    label: config.label ?? labelOverride,
    createdBy: 'human',
  });
  try {
    await session.open();
  } catch {
    // SessionBase has already transitioned to errored; UI needs the tab metadata.
  }
  return { sessionId: session.id, state: session.state };
}
