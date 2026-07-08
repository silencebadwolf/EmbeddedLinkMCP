import { electron } from '../electron-runtime.js';
import type { ControlProfileManager, HostPathResolver } from '../../core/workspace/index.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import {
  ConnectionProfileManager,
  ConnectionProfileNotFoundError,
  CredentialDecryptFailedError,
  CredentialRequiredError,
  CredentialStorageUnavailableError,
  savedConnectionConfigSchema,
  type SavedConnectionSummary,
} from '../../core/connections/index.js';
import { openSessionInputSchema } from '../../mcp/surfaces/terminal/schemas.js';
import type { IJLinkBackend } from '../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../jlink/device-catalog.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  PreloadResult,
  SaveConnectionProfileConfig,
  SavedConnectionOpenSuccess,
  SessionCreateRequestConfig,
} from '../../shared/preload-api.js';
import type { SessionId, SessionState } from '../../shared/types.js';
import { createAndOpenSession } from './session-open-helper.js';
import { openRttLogFromRequest, rttLogOpenErrorCodeOf } from './rtt-log-open-helper.js';

const { ipcMain } = electron;

type SaveAndOpenResult = PreloadResult<SavedConnectionOpenSuccess>;

type OpenSavedResult = SaveAndOpenResult;

/** Register global saved-connection IPC handlers. */
export function registerConnectionProfilesIpc(
  sessionManager: SessionManager,
  profileManager: ConnectionProfileManager,
  jlinkBackend?: IJLinkBackend,
  controlProfileManager?: ControlProfileManager,
  jlinkDeviceCatalog?: JLinkDeviceCatalog,
  hostPathResolver?: HostPathResolver,
): () => void {
  ipcMain.handle(IPC_CHANNELS.CONNECTIONS_LIST, async (): Promise<PreloadResult<ReadonlyArray<SavedConnectionSummary>>> => {
    try {
      return { success: true, data: await profileManager.list() };
    } catch (err) {
      return toIpcError(err);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN,
    async (_event, raw: unknown): Promise<SaveAndOpenResult> => {
      try {
        const input = parseSaveAndOpen(raw);
        const profile = await profileManager.save(input);
        const session = await openSavedConnectionConfig(input.config, {
          label: input.label,
          sessionManager,
          jlinkBackend,
          controlProfileManager,
          jlinkDeviceCatalog,
          hostPathResolver,
        });
        return { success: true, data: { profile, ...session } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_OPEN,
    async (_event, raw: unknown): Promise<OpenSavedResult> => {
      try {
        const profileId = parseProfileId(raw);
        const config = await profileManager.openConfig(profileId);
        const profile = (await profileManager.list()).find((p) => p.id === profileId);
        if (!profile) throw new ConnectionProfileNotFoundError(profileId);
        const session = await openSavedConnectionConfig(config, {
          label: profile.label,
          sessionManager,
          jlinkBackend,
          controlProfileManager,
          jlinkDeviceCatalog,
          hostPathResolver,
        });
        return { success: true, data: { profile, ...session } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_DELETE,
    async (_event, raw: unknown): Promise<PreloadResult<{ deleted: true }>> => {
      try {
        await profileManager.delete(parseProfileId(raw));
        return { success: true, data: { deleted: true } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_DELETE);
  };
}

function parseSaveAndOpen(raw: unknown): {
  label: string;
  config: SaveConnectionProfileConfig;
  saveCredentials?: boolean;
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as { config?: unknown; label?: unknown; saveCredentials?: unknown };
  const parsed = parseSavedConnectionConfig(r.config);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  if (typeof r.label !== 'string' || r.label.trim().length === 0) {
    throw new Error('label is required');
  }
  return {
    label: r.label,
    config: parsed.data,
    ...(typeof r.saveCredentials === 'boolean' ? { saveCredentials: r.saveCredentials } : {}),
  };
}

type ParseSavedConnectionConfigResult =
  | { success: true; data: SaveConnectionProfileConfig }
  | { success: false; error: { issues: Array<{ message: string }> } };

function parseSavedConnectionConfig(config: unknown): ParseSavedConnectionConfigResult {
  if (typeof config === 'object' && config !== null && (config as { type?: unknown }).type === 'rtt-log') {
    const parsed = savedConnectionConfigSchema.safeParse(config);
    if (!parsed.success) return parsed;
    if (parsed.data.type !== 'rtt-log') {
      return { success: false, error: { issues: [{ message: 'config.type must be rtt-log' }] } };
    }
    return { success: true, data: parsed.data };
  }
  const parsed = openSessionInputSchema.safeParse({ config });
  if (!parsed.success) return parsed;
  return { success: true, data: parsed.data.config as SessionCreateRequestConfig };
}

async function openSavedConnectionConfig(
  config: SaveConnectionProfileConfig,
  deps: {
    label: string;
    sessionManager: SessionManager;
    jlinkBackend?: IJLinkBackend;
    controlProfileManager?: ControlProfileManager;
    jlinkDeviceCatalog?: JLinkDeviceCatalog;
    hostPathResolver?: HostPathResolver;
  },
): Promise<{ sessionId: SessionId; state: SessionState; rttLog?: { probeId: string; channelIndex: number } }> {
  if (config.type !== 'rtt-log') {
    return createAndOpenSession(deps.sessionManager, config as SessionCreateRequestConfig, deps.label);
  }
  if (deps.jlinkBackend === undefined) {
    throw new Error('RTT saved profiles require a J-Link backend');
  }
  const result = await openRttLogFromRequest(
    {
      ...config,
      label: deps.label,
    },
    {
      sessionManager: deps.sessionManager,
      jlinkBackend: deps.jlinkBackend,
      controlProfileManager: deps.controlProfileManager,
      jlinkDeviceCatalog: deps.jlinkDeviceCatalog,
      hostPathResolver: deps.hostPathResolver,
    },
  );
  return {
    sessionId: result.sessionId,
    state: result.state,
    ...(result.probeId !== undefined && result.channelIndex !== undefined
      ? { rttLog: { probeId: result.probeId, channelIndex: result.channelIndex } }
      : {}),
  };
}

function parseProfileId(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const profileId = (raw as { profileId?: unknown }).profileId;
  if (typeof profileId !== 'string' || profileId.length === 0) throw new Error('profileId is required');
  return profileId;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  if (err instanceof CredentialStorageUnavailableError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof CredentialRequiredError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof CredentialDecryptFailedError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ConnectionProfileNotFoundError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const rttCode = rttLogOpenErrorCodeOf(err);
  if (rttCode !== 'INTERNAL') {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: { code: rttCode, message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
