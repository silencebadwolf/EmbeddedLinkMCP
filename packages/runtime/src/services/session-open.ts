import type { SessionManager } from '../core/session/session-manager.js';
import type { SerialSessionCoordinator } from '../core/session/serial-session-coordinator.js';
import { buildSession } from '../core/session/factory.js';
import type { SessionId, SessionState } from '@linkterm/contracts/types';
import type { SessionCreateRequestConfig } from '@linkterm/contracts/preload-api';

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
  serialSessionCoordinator?: SerialSessionCoordinator,
): Promise<{ sessionId: SessionId; state: SessionState }> {
  if (config.type === 'serial' && serialSessionCoordinator !== undefined) {
    const result = await serialSessionCoordinator.openOrReuse(config, () =>
      createAndOpenNewSession(sessionManager, config, labelOverride),
    );
    return { sessionId: result.sessionId, state: result.state };
  }
  return createAndOpenNewSession(sessionManager, config, labelOverride);
}

async function createAndOpenNewSession(
  sessionManager: SessionManager,
  config: SessionCreateRequestConfig,
  labelOverride?: string,
): Promise<{ sessionId: SessionId; state: SessionState }> {
  const session = sessionManager.create(
    (id) => (sessionManager.sessionFactory ?? buildSession)(id, config),
    {
      connectionType: config.type,
      label: config.label ?? labelOverride,
      createdBy: 'human',
      ...(config.type === 'serial'
        ? { serial: { port: config.port, baudRate: config.baudRate, mode: config.mode } }
        : {}),
    },
  );
  try {
    await sessionManager.openSession(session);
  } catch {
    // SessionBase has already transitioned to errored; UI needs the tab metadata.
  }
  return { sessionId: session.id, state: session.state };
}
