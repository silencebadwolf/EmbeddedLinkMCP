import { electron } from '../../platform/electron-runtime.js';
import type { ControlProfileManager, HostPathResolver } from '@linkterm/runtime/core/workspace/index';
import type { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import {
  SerialSessionConflictError,
  SerialSessionCoordinator,
} from '@linkterm/runtime/core/session/serial-session-coordinator';
import {
  ConnectionProfileManager,
  ConnectionProfileConflictError,
  ConnectionProfileNotFoundError,
  ConnectionProfileTypeChangeError,
  CredentialDecryptFailedError,
  CredentialRequiredError,
  CredentialStorageUnavailableError,
  savedConnectionConfigSchema,
  type SavedConnectionSummary,
} from '@linkterm/runtime/core/connections/index';
import { openSessionInputSchema } from '@linkterm/mcp/surfaces/terminal/schemas';
import type { IJLinkBackend } from '@linkterm/runtime/jlink/types';
import type { JLinkDeviceCatalog } from '@linkterm/runtime/jlink/device-catalog';
import { IPC_CHANNELS } from '../../ipc/channels.js';
import type {
  PreloadResult,
  SaveConnectionProfileConfig,
  SavedConnectionOpenSuccess,
  SessionCreateRequestConfig,
  UpdateConnectionProfileRequest,
} from '@linkterm/contracts/preload-api';
import type { StableSerialIdentity } from '@linkterm/contracts/types';
import type { SessionId, SessionState } from '@linkterm/contracts/types';
import { createAndOpenSession } from '@linkterm/runtime/services/session-open';
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
  serialSessionCoordinator: SerialSessionCoordinator = new SerialSessionCoordinator(sessionManager),
  serialIdentityLookup?: (portPath: string) => Promise<StableSerialIdentity | undefined>,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_LIST,
    async (): Promise<PreloadResult<ReadonlyArray<SavedConnectionSummary>>> => {
      try {
        return { success: true, data: await profileManager.list() };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN,
    async (_event, raw: unknown): Promise<SaveAndOpenResult> => {
      try {
        const input = await enrichSerialIdentity(parseSaveAndOpen(raw), serialIdentityLookup);
        const profile = await profileManager.save(input);
        const session = await openSavedConnectionConfig(input.config, {
          label: input.label,
          sessionManager,
          jlinkBackend,
          controlProfileManager,
          jlinkDeviceCatalog,
          hostPathResolver,
          serialSessionCoordinator,
        });
        return { success: true, data: { profile, ...session } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_UPDATE,
    async (_event, raw: unknown): Promise<PreloadResult<SavedConnectionSummary>> => {
      try {
        const input = await enrichSerialIdentity(parseUpdate(raw), serialIdentityLookup);
        return { success: true, data: await profileManager.update(input) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONNECTIONS_UPDATE_AND_OPEN,
    async (_event, raw: unknown): Promise<OpenSavedResult> => {
      try {
        const input = await enrichSerialIdentity(parseUpdate(raw), serialIdentityLookup);
        const profile = await profileManager.update(input);
        const config = await profileManager.openConfig(profile.id);
        const session = await openSavedConnectionConfig(config, {
          label: profile.label,
          sessionManager,
          jlinkBackend,
          controlProfileManager,
          jlinkDeviceCatalog,
          hostPathResolver,
          serialSessionCoordinator,
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
          serialSessionCoordinator,
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
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_UPDATE);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_UPDATE_AND_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONNECTIONS_DELETE);
  };
}

async function enrichSerialIdentity<
  T extends { config: SaveConnectionProfileConfig | UpdateConnectionProfileRequest['config'] },
>(
  input: T,
  lookup: ((portPath: string) => Promise<StableSerialIdentity | undefined>) | undefined,
): Promise<T> {
  if (input.config.type !== 'serial' || lookup === undefined) return input;
  const identity = await lookup(input.config.port).catch(() => undefined);
  if (identity === undefined) return input;
  return { ...input, config: { ...input.config, ...identity } };
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

function parseUpdate(raw: unknown): UpdateConnectionProfileRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as {
    profileId?: unknown;
    expectedUpdatedAt?: unknown;
    label?: unknown;
    config?: unknown;
    credentialAction?: unknown;
  };
  if (typeof r.profileId !== 'string' || r.profileId.length === 0) {
    throw new Error('profileId is required');
  }
  if (typeof r.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(r.expectedUpdatedAt))) {
    throw new Error('expectedUpdatedAt must be an ISO timestamp');
  }
  if (typeof r.label !== 'string' || r.label.trim().length === 0) {
    throw new Error('label is required');
  }
  const credentialAction = r.credentialAction ?? 'preserve';
  if (!['preserve', 'replace', 'clear'].includes(String(credentialAction))) {
    throw new Error('credentialAction is invalid');
  }
  const config = parseUpdateConfig(r.config, credentialAction === 'replace');
  return {
    profileId: r.profileId,
    expectedUpdatedAt: r.expectedUpdatedAt,
    label: r.label,
    config,
    credentialAction: credentialAction as UpdateConnectionProfileRequest['credentialAction'],
  };
}

function parseUpdateConfig(
  config: unknown,
  replacingCredential: boolean,
): UpdateConnectionProfileRequest['config'] {
  if (
    typeof config === 'object' &&
    config !== null &&
    (config as { type?: unknown }).type === 'ssh' &&
    !replacingCredential
  ) {
    const parsed = savedConnectionConfigSchema.safeParse(config);
    if (!parsed.success || parsed.data.type !== 'ssh') {
      const message = parsed.success
        ? 'config.type must be ssh'
        : parsed.error.issues.map((issue) => issue.message).join('; ');
      throw new Error(message);
    }
    return parsed.data;
  }
  const parsed = parseSavedConnectionConfig(config);
  if (!parsed.success)
    throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

type ParseSavedConnectionConfigResult =
  | { success: true; data: SaveConnectionProfileConfig }
  | { success: false; error: { issues: Array<{ message: string }> } };

function parseSavedConnectionConfig(config: unknown): ParseSavedConnectionConfigResult {
  if (
    typeof config === 'object' &&
    config !== null &&
    (config as { type?: unknown }).type === 'rtt-log'
  ) {
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
    serialSessionCoordinator: SerialSessionCoordinator;
  },
): Promise<{
  sessionId: SessionId;
  state: SessionState;
  rttLog?: { probeId: string; channelIndex: number };
}> {
  if (config.type !== 'rtt-log') {
    return createAndOpenSession(
      deps.sessionManager,
      config as SessionCreateRequestConfig,
      deps.label,
      deps.serialSessionCoordinator,
    );
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
  if (typeof profileId !== 'string' || profileId.length === 0)
    throw new Error('profileId is required');
  return profileId;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  if (err instanceof SerialSessionConflictError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {
          port: err.port,
          existingSessionId: err.existingSessionId,
          existing: err.existing,
          requested: err.requested,
        },
      },
    };
  }
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
  if (err instanceof ConnectionProfileConflictError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {
          profileId: err.profileId,
          expectedUpdatedAt: err.expectedUpdatedAt,
          actualUpdatedAt: err.actualUpdatedAt,
        },
      },
    };
  }
  if (err instanceof ConnectionProfileTypeChangeError) {
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
