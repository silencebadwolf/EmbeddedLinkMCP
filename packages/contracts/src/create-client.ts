import { z, type ZodType } from 'zod';
import {
  ActivityEventViewSchema,
  ActivitySnapshotResultSchema,
  ActivityUnsubscribeResultSchema,
} from './activity-contract.js';
import {
  AuditClearResultEnvelopeSchema,
  AuditClearRequestSchema,
  AuditExportRequestSchema,
  AuditExportResultEnvelopeSchema,
  AuditStatusResultEnvelopeSchema,
} from './audit-contract.js';
import {
  ReadinessEventSchema,
  ReadinessFailureResultSchema,
  ReadinessRefreshResultSchema,
} from './readiness-contract.js';
import {
  FirstSignalEventSchema,
  FirstSignalFailureResultSchema,
  FirstSignalStartResultSchema,
  type FirstSignalFailureResult,
} from './first-signal-contract.js';
import type {
  ActivityNamespace,
  FirstSignalNamespace,
  PreloadAPI,
  PreloadResult,
  ReadinessNamespace,
  SessionCreateRequestPayload,
  SessionWriteRequestPayload,
  SessionReadRequestPayload,
  SessionReadSuccess,
  TranscriptSubscribeSuccess,
  Unsubscribe,
  UiStatePatch,
  SavedConnectionSummary,
  AgentIntegrationStatus,
  AgentIntegrationInstallResult,
  AgentIntegrationUninstallResult,
  AgentIntegrationDiagnosticResult,
  JLinkDeviceInfoPayload,
  JLinkDeviceSearchResultPayload,
  ControlProfileDownloadJobPayload,
  ControlProfileChipProbePayload,
  JLinkVcomRecoveryPayload,
  ControlProfileFilePayload,
  ControlProfileDownloadResultPayload,
  SavedControlProfileRecordPayload,
  RttLogOpenSuccess,
  SavedConnectionOpenSuccess,
} from './preload-api.js';
import type {
  SessionId,
  SessionLifecycleEvent,
  SessionState,
  SessionSummary,
  SerialPortInfo,
} from './types.js';
import type { TranscriptEventEnvelope } from './transcript-ipc-types.js';

import { CLIENT_CHANNELS as IPC_CHANNELS } from './client-protocol.js';
import type {
  ClientTransport,
  ClientTransportEvent as IpcRendererEvent,
} from './client-transport.js';

/** Construct the same typed client over desktop IPC or authenticated network transport. */
export function createClientAPI(ipcRenderer: ClientTransport): PreloadAPI {
  /** 包一层 invoke：把 channel 字符串集中在 preload，而非散落到 hooks。 */
  const invoke = <T>(channel: string, payload?: unknown): Promise<PreloadResult<T>> =>
    ipcRenderer.invoke(channel, payload) as Promise<PreloadResult<T>>;

  /**
   * 注册一个长寿命 channel listener，并返回 unsubscribe 函数。
   *
   * 之所以包装而非直接暴露 `ipcRenderer.on`：renderer 端不应能调用 `removeAllListeners`，
   * 那会清掉同 channel 上其它组件的监听器，导致难以排查的副作用。
   */
  const subscribe = <T>(channel: string, handler: (payload: T) => void): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

  const invalidActivityPayload = (): PreloadResult<never> => ({
    success: false,
    error: { code: 'INVALID_PAYLOAD', message: 'Invalid activity payload' },
  });

  const invalidReadinessPayload = (): PreloadResult<never> => ({
    success: false,
    error: { code: 'INVALID_PAYLOAD', message: 'Invalid readiness payload' },
  });

  const invalidFirstSignalPayload = (): FirstSignalFailureResult => ({
    success: false,
    error: { code: 'INVALID_PAYLOAD', message: 'Invalid first-signal payload' },
  });

  const invalidAuditPayload = (): PreloadResult<never> => ({
    success: false,
    error: { code: 'INVALID_AUDIT_PAYLOAD', message: 'Invalid audit payload' },
  });

  const invokeActivity = async <T>(
    channel: string,
    schema: ZodType<PreloadResult<T>>,
    payload?: unknown,
  ): Promise<PreloadResult<T>> => {
    const raw: unknown = await ipcRenderer.invoke(channel, payload);
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : invalidActivityPayload();
  };

  const invokeReadiness = async <T>(
    channel: string,
    schema: ZodType<PreloadResult<T>>,
    payload?: unknown,
  ): Promise<PreloadResult<T>> => {
    const raw: unknown = await ipcRenderer.invoke(channel, payload);
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : invalidReadinessPayload();
  };

  const invokeFirstSignal = async <T>(
    channel: string,
    schema: ZodType<T>,
    payload?: unknown,
  ): Promise<T> => {
    const raw: unknown = await ipcRenderer.invoke(channel, payload);
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : (invalidFirstSignalPayload() as T);
  };

  const invokeAudit = async <T>(
    channel: string,
    schema: ZodType<PreloadResult<T>>,
    payload: unknown = {},
  ): Promise<PreloadResult<T>> => {
    const raw: unknown = await ipcRenderer.invoke(channel, payload);
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : invalidAuditPayload();
  };

  const activity: ActivityNamespace = {
    subscribe: (req = {}) =>
      invokeActivity(IPC_CHANNELS.ACTIVITY_SUBSCRIBE, ActivitySnapshotResultSchema, req),
    snapshot: (req = {}) =>
      invokeActivity(IPC_CHANNELS.ACTIVITY_SNAPSHOT, ActivitySnapshotResultSchema, req),
    unsubscribe: () =>
      invokeActivity(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE, ActivityUnsubscribeResultSchema, {}),
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        const parsed = ActivityEventViewSchema.safeParse(payload);
        if (parsed.success) handler(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.ACTIVITY_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ACTIVITY_EVENT, listener);
      };
    },
    status: () => invokeAudit(IPC_CHANNELS.ACTIVITY_STATUS, AuditStatusResultEnvelopeSchema, {}),
    export: (req = { format: 'jsonl' as const }) => {
      const parsed = AuditExportRequestSchema.safeParse(req);
      return parsed.success
        ? invokeAudit(IPC_CHANNELS.ACTIVITY_EXPORT, AuditExportResultEnvelopeSchema, parsed.data)
        : Promise.resolve(invalidAuditPayload());
    },
    clear: (req) => {
      const parsed = AuditClearRequestSchema.safeParse(req);
      return parsed.success
        ? invokeAudit(IPC_CHANNELS.ACTIVITY_CLEAR, AuditClearResultEnvelopeSchema, parsed.data)
        : Promise.resolve(invalidAuditPayload());
    },
  };

  const ReadinessUnsubscribeResultSchema = z.discriminatedUnion('success', [
    z
      .object({
        success: z.literal(true),
        data: z
          .object({ unsubscribed: z.literal(true) })
          .strict()
          .readonly(),
      })
      .strict()
      .readonly(),
    ReadinessFailureResultSchema,
  ]);

  const readiness: ReadinessNamespace = {
    get: () => invokeReadiness(IPC_CHANNELS.READINESS_GET, ReadinessRefreshResultSchema, {}),
    refresh: () =>
      invokeReadiness(IPC_CHANNELS.READINESS_REFRESH, ReadinessRefreshResultSchema, {}),
    subscribe: (req = {}) =>
      invokeReadiness(IPC_CHANNELS.READINESS_SUBSCRIBE, ReadinessRefreshResultSchema, req),
    unsubscribe: () =>
      invokeReadiness(IPC_CHANNELS.READINESS_UNSUBSCRIBE, ReadinessUnsubscribeResultSchema, {}),
    onEvent: (handler, onInvalidPayload) => {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        const parsed = ReadinessEventSchema.safeParse(payload);
        if (parsed.success) {
          handler(parsed.data);
          return;
        }
        onInvalidPayload?.({ code: 'readiness.invalid_payload', severity: 'error' });
      };
      ipcRenderer.on(IPC_CHANNELS.READINESS_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.READINESS_EVENT, listener);
      };
    },
  };

  const FirstSignalUnsubscribeResultSchema = z.discriminatedUnion('success', [
    z
      .object({
        success: z.literal(true),
        data: z
          .object({ unsubscribed: z.literal(true) })
          .strict()
          .readonly(),
      })
      .strict()
      .readonly(),
    FirstSignalFailureResultSchema,
  ]);

  const firstSignal: FirstSignalNamespace = {
    start: (req) =>
      invokeFirstSignal(IPC_CHANNELS.FIRST_SIGNAL_START, FirstSignalStartResultSchema, req),
    status: (req) =>
      invokeFirstSignal(IPC_CHANNELS.FIRST_SIGNAL_STATUS, FirstSignalStartResultSchema, req),
    stop: (req) =>
      invokeFirstSignal(IPC_CHANNELS.FIRST_SIGNAL_STOP, FirstSignalStartResultSchema, req),
    subscribe: (req) =>
      invokeFirstSignal(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE, FirstSignalStartResultSchema, req),
    unsubscribe: () =>
      invokeFirstSignal(
        IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE,
        FirstSignalUnsubscribeResultSchema,
        {},
      ),
    onEvent: (handler, onInvalidPayload) => {
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        const parsed = FirstSignalEventSchema.safeParse(payload);
        if (parsed.success) {
          handler(parsed.data);
          return;
        }
        onInvalidPayload?.({ code: 'firstSignal.invalid_payload', severity: 'error' });
      };
      ipcRenderer.on(IPC_CHANNELS.FIRST_SIGNAL_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.FIRST_SIGNAL_EVENT, listener);
      };
    },
  };

  const api: PreloadAPI = {
    session: {
      create: (req: SessionCreateRequestPayload) =>
        invoke<{ sessionId: SessionId; state: SessionState }>(IPC_CHANNELS.SESSION_CREATE, req),
      write: (req: SessionWriteRequestPayload) =>
        invoke<{ bytesWritten: number }>(IPC_CHANNELS.SESSION_WRITE, req),
      read: (req: SessionReadRequestPayload) =>
        invoke<SessionReadSuccess>(IPC_CHANNELS.SESSION_READ, req),
      clear: (req) => invoke<{ sequence: number }>(IPC_CHANNELS.SESSION_CLEAR, req),
      list: () => invoke<{ sessions: ReadonlyArray<SessionSummary> }>(IPC_CHANNELS.SESSION_LIST),
      status: (req) =>
        invoke<{ sessionId: SessionId; state: SessionState; latestCursor: number }>(
          IPC_CHANNELS.SESSION_STATUS,
          req,
        ),
      resize: (req) => invoke<{ resized: boolean }>(IPC_CHANNELS.SESSION_RESIZE, req),
      destroy: (req) => invoke<{ destroyed: true }>(IPC_CHANNELS.SESSION_DESTROY, req),
      onLifecycle: (handler) =>
        subscribe<SessionLifecycleEvent>(IPC_CHANNELS.SESSION_LIFECYCLE, handler),
      subscribe: (req) =>
        invoke<TranscriptSubscribeSuccess>(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, req),
    },
    rttLog: {
      open: (req) => invoke<RttLogOpenSuccess>(IPC_CHANNELS.RTT_LOG_OPEN, req),
    },
    serial: {
      listPorts: () => invoke<ReadonlyArray<SerialPortInfo>>(IPC_CHANNELS.SERIAL_LIST_PORTS),
      onPortChanged: (handler) =>
        subscribe<ReadonlyArray<SerialPortInfo>>(IPC_CHANNELS.SERIAL_PORT_CHANGED, handler),
    },
    transcript: {
      onEvent: (handler) =>
        subscribe<TranscriptEventEnvelope>(IPC_CHANNELS.TRANSCRIPT_EVENT, handler),
    },
    ui: {
      onStatePatch: (handler) => subscribe<UiStatePatch>(IPC_CHANNELS.UI_STATE_PATCH, handler),
    },
    activity,
    readiness,
    firstSignal,
    connections: {
      list: () => invoke<ReadonlyArray<SavedConnectionSummary>>(IPC_CHANNELS.CONNECTIONS_LIST),
      saveAndOpen: (req) =>
        invoke<SavedConnectionOpenSuccess>(IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN, req),
      update: (req) => invoke<SavedConnectionSummary>(IPC_CHANNELS.CONNECTIONS_UPDATE, req),
      updateAndOpen: (req) =>
        invoke<SavedConnectionOpenSuccess>(IPC_CHANNELS.CONNECTIONS_UPDATE_AND_OPEN, req),
      open: (req) => invoke<SavedConnectionOpenSuccess>(IPC_CHANNELS.CONNECTIONS_OPEN, req),
      delete: (req) => invoke<{ deleted: true }>(IPC_CHANNELS.CONNECTIONS_DELETE, req),
    },
    agentIntegrations: {
      list: () =>
        invoke<ReadonlyArray<AgentIntegrationStatus>>(IPC_CHANNELS.AGENT_INTEGRATIONS_LIST),
      install: (req) =>
        invoke<AgentIntegrationInstallResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL, req),
      uninstall: (req) =>
        invoke<AgentIntegrationUninstallResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_UNINSTALL, req),
      diagnose: (req) =>
        invoke<AgentIntegrationDiagnosticResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_DIAGNOSE, req),
    },
    jlinkDevices: {
      search: (req) =>
        invoke<JLinkDeviceSearchResultPayload>(IPC_CHANNELS.JLINK_DEVICES_SEARCH, req),
      get: (req) =>
        invoke<{ device?: JLinkDeviceInfoPayload }>(IPC_CHANNELS.JLINK_DEVICES_GET, req),
      refresh: () => invoke<{ refreshed: true }>(IPC_CHANNELS.JLINK_DEVICES_REFRESH),
    },
    controlProfile: {
      save: (req) =>
        invoke<{
          path: string;
          profile: ControlProfileFilePayload;
          record?: SavedControlProfileRecordPayload;
        }>(IPC_CHANNELS.CONTROL_PROFILE_SAVE, req),
      load: (req) =>
        invoke<{ path: string; profile: ControlProfileFilePayload }>(
          IPC_CHANNELS.CONTROL_PROFILE_LOAD,
          req,
        ),
      listRecords: () =>
        invoke<ReadonlyArray<SavedControlProfileRecordPayload>>(
          IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST,
        ),
      openRecord: (req) =>
        invoke<{ path: string; record: SavedControlProfileRecordPayload }>(
          IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN,
          req,
        ),
      deleteRecord: (req) =>
        invoke<{ deleted: true }>(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_DELETE, req),
      recoverJlinkVcom: (req) =>
        invoke<JLinkVcomRecoveryPayload>(IPC_CHANNELS.CONTROL_PROFILE_RECOVER_JLINK_VCOM, req),
      runDownload: (req) =>
        invoke<ControlProfileDownloadResultPayload>(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD, req),
      startDownload: (req) =>
        invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD, req),
      startCompensationReflash: (req) =>
        invoke<ControlProfileDownloadJobPayload>(
          IPC_CHANNELS.CONTROL_PROFILE_START_COMPENSATION_REFLASH,
          req,
        ),
      saveProfileSuggestion: (req) =>
        invoke<{
          path: string;
          profile: ControlProfileFilePayload;
          record?: SavedControlProfileRecordPayload;
        }>(IPC_CHANNELS.CONTROL_PROFILE_SAVE_PROFILE_SUGGESTION, req),
      getDownloadStatus: (req) =>
        invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_STATUS, req),
      readDownload: (req) =>
        invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_READ, req),
      cancelDownload: (req) =>
        invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_CANCEL, req),
      connectChip: (req) =>
        invoke<{ probe: ControlProfileChipProbePayload }>(
          IPC_CHANNELS.CONTROL_PROFILE_CONNECT_CHIP,
          req,
        ),
      disconnectChip: (req) =>
        invoke<{ probeId: string; disconnected: true }>(
          IPC_CHANNELS.CONTROL_PROFILE_DISCONNECT_CHIP,
          req,
        ),
      pickWorkspaceRoot: () =>
        invoke<{ root: string | null }>(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT),
      pickFirmwareFile: () =>
        invoke<{ path: string | null }>(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE),
    },
  };

  return api;
}
