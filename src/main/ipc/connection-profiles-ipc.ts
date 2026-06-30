import { electron } from '../electron-runtime.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import {
  ConnectionProfileManager,
  ConnectionProfileNotFoundError,
  CredentialDecryptFailedError,
  CredentialRequiredError,
  CredentialStorageUnavailableError,
  type SavedConnectionSummary,
} from '../../core/connections/index.js';
import { openSessionInputSchema } from '../../mcp/surfaces/terminal/schemas.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { PreloadResult, SessionCreateRequestConfig } from '../../shared/preload-api.js';
import type { SessionId, SessionState } from '../../shared/types.js';
import { createAndOpenSession } from './session-open-helper.js';

const { ipcMain } = electron;

type SaveAndOpenResult = PreloadResult<{
  profile: SavedConnectionSummary;
  sessionId: SessionId;
  state: SessionState;
}>;

type OpenSavedResult = SaveAndOpenResult;

/** Register global saved-connection IPC handlers. */
export function registerConnectionProfilesIpc(
  sessionManager: SessionManager,
  profileManager: ConnectionProfileManager,
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
        const session = await createAndOpenSession(sessionManager, input.config, input.label);
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
        const session = await createAndOpenSession(sessionManager, config, profile.label);
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
  config: SessionCreateRequestConfig;
  saveCredentials?: boolean;
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as { config?: unknown; label?: unknown; saveCredentials?: unknown };
  const parsed = openSessionInputSchema.safeParse({ config: r.config });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  if (typeof r.label !== 'string' || r.label.trim().length === 0) {
    throw new Error('label is required');
  }
  return {
    label: r.label,
    config: parsed.data.config as SessionCreateRequestConfig,
    ...(typeof r.saveCredentials === 'boolean' ? { saveCredentials: r.saveCredentials } : {}),
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
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
