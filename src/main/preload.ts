/**
 * Electron preload 脚本。
 *
 * 在 contextIsolation=true 的隔离上下文中运行，通过 `contextBridge.exposeInMainWorld('linkterm', api)`
 * 把窄化后的 IPC 接口暴露给渲染进程。
 *
 * 安全不变量：
 * - 不暴露 `ipcRenderer` —— 否则 contextIsolation 形同虚设，渲染端可任意触发 channel；
 * - 不在 preload 端造 subscriberId —— Phase 5 主进程已按 `webContents.id` 派生（IPC handler 内部完成）；
 * - 暴露形状必须与 `src/shared/preload-api.ts` 中 `PreloadAPI` 类型一致 —— 任何字段差异都会让
 *   renderer 端的 `window.linkterm` 类型断言变成静默失败。
 */

import type { IpcRendererEvent } from 'electron';
import { electron } from './electron-runtime.js';
import { IPC_CHANNELS } from '../shared/ipc-protocol.js';
import type {
  PreloadAPI,
  PreloadResult,
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
  ControlProfileFilePayload,
  ControlProfileDownloadResultPayload,
  SavedControlProfileRecordPayload,
  RttLogOpenSuccess,
  SavedConnectionOpenSuccess,
} from '../shared/preload-api.js';
import type {
  SessionId,
  SessionLifecycleEvent,
  SessionState,
  SessionSummary,
  SerialPortInfo,
} from '../shared/types.js';
import type { TranscriptEventEnvelope } from '../shared/transcript-ipc-types.js';

const { contextBridge, ipcRenderer } = electron;

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
    subscribe: (req) => invoke<TranscriptSubscribeSuccess>(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE, req),
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
  connections: {
    list: () => invoke<ReadonlyArray<SavedConnectionSummary>>(IPC_CHANNELS.CONNECTIONS_LIST),
    saveAndOpen: (req) =>
      invoke<SavedConnectionOpenSuccess>(IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN, req),
    open: (req) =>
      invoke<SavedConnectionOpenSuccess>(IPC_CHANNELS.CONNECTIONS_OPEN, req),
    delete: (req) => invoke<{ deleted: true }>(IPC_CHANNELS.CONNECTIONS_DELETE, req),
  },
  agentIntegrations: {
    list: () => invoke<ReadonlyArray<AgentIntegrationStatus>>(IPC_CHANNELS.AGENT_INTEGRATIONS_LIST),
    install: (req) =>
      invoke<AgentIntegrationInstallResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_INSTALL, req),
    uninstall: (req) =>
      invoke<AgentIntegrationUninstallResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_UNINSTALL, req),
    diagnose: (req) =>
      invoke<AgentIntegrationDiagnosticResult>(IPC_CHANNELS.AGENT_INTEGRATIONS_DIAGNOSE, req),
  },
  jlinkDevices: {
    search: (req) => invoke<JLinkDeviceSearchResultPayload>(IPC_CHANNELS.JLINK_DEVICES_SEARCH, req),
    get: (req) => invoke<{ device?: JLinkDeviceInfoPayload }>(IPC_CHANNELS.JLINK_DEVICES_GET, req),
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
    runDownload: (req) =>
      invoke<ControlProfileDownloadResultPayload>(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD, req),
    startDownload: (req) =>
      invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD, req),
    getDownloadStatus: (req) =>
      invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_STATUS, req),
    readDownload: (req) =>
      invoke<ControlProfileDownloadJobPayload>(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_READ, req),
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

contextBridge.exposeInMainWorld('linkterm', api);
