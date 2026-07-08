/**
 * 类型化的 `window.linkterm` mock 工厂。
 *
 * 每个 renderer 测试在 beforeEach 调用 `installMockPreload()`，得到一个可观察 mock；
 * 测试用 `mock.session.create.mockResolvedValueOnce(...)` 配置预期返回值。
 */

import { vi } from 'vitest';
import type {
  PreloadAPI,
  PreloadResult,
  SavedConnectionSummary,
  SessionReadSuccess,
  TranscriptSubscribeSuccess,
  Unsubscribe,
  UiStatePatch,
  AgentIntegrationStatus,
  AgentIntegrationInstallResult,
  AgentIntegrationUninstallResult,
  AgentIntegrationDiagnosticResult,
  JLinkDeviceSearchResultPayload,
  ControlProfileDownloadJobPayload,
  ControlProfileFilePayload,
  ControlProfileDownloadResultPayload,
  SavedControlProfileRecordPayload,
} from '../../src/shared/preload-api.js';
import type { TranscriptEventEnvelope } from '../../src/shared/transcript-ipc-types.js';
import type {
  SerialPortInfo,
  SessionLifecycleEvent,
  SessionSummary,
} from '../../src/shared/types.js';

/** 可观测的 mock preload API；所有方法都是 vi.fn()。 */
export interface MockPreloadAPI {
  api: PreloadAPI;
  /** 测试可调用此函数模拟主进程推送 transcript 事件。 */
  emitTranscript(envelope: TranscriptEventEnvelope): void;
  /** 测试可调用此函数模拟主进程推送 session 生命周期事件。 */
  emitSessionLifecycle(event: SessionLifecycleEvent): void;
  /** 测试可调用此函数模拟串口插拔变化。 */
  emitPortChange(ports: ReadonlyArray<SerialPortInfo>): void;
  /**
   * Phase 10：模拟主进程通过 `UI_STATE_PATCH` channel 推送 UI patch。
   * 用法：`mock.emitUiPatch({ action: 'set_locale', locale: 'zh' })`。
   */
  emitUiPatch(patch: UiStatePatch): void;
  /** 详细的 spy 对象。 */
  spies: {
    session: {
      create: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      read: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
      status: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    };
    rttLog: {
      open: ReturnType<typeof vi.fn>;
    };
    serial: {
      listPorts: ReturnType<typeof vi.fn>;
    };
    connections: {
      list: ReturnType<typeof vi.fn>;
      saveAndOpen: ReturnType<typeof vi.fn>;
      open: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    agentIntegrations: {
      list: ReturnType<typeof vi.fn>;
      install: ReturnType<typeof vi.fn>;
      uninstall: ReturnType<typeof vi.fn>;
      diagnose: ReturnType<typeof vi.fn>;
    };
    jlinkDevices: {
      search: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      refresh: ReturnType<typeof vi.fn>;
    };
    controlProfile: {
      save: ReturnType<typeof vi.fn>;
      load: ReturnType<typeof vi.fn>;
      listRecords: ReturnType<typeof vi.fn>;
      openRecord: ReturnType<typeof vi.fn>;
      deleteRecord: ReturnType<typeof vi.fn>;
      runDownload: ReturnType<typeof vi.fn>;
      startDownload: ReturnType<typeof vi.fn>;
      getDownloadStatus: ReturnType<typeof vi.fn>;
      readDownload: ReturnType<typeof vi.fn>;
      pickWorkspaceRoot: ReturnType<typeof vi.fn>;
      pickFirmwareFile: ReturnType<typeof vi.fn>;
    };
  };
}

const okEmpty = <T>(data: T): PreloadResult<T> => ({ success: true, data });

/**
 * 构造 PreloadAPI mock.
 *
 * 默认所有方法返回 `{success:true, data:{}}` 占位；具体测试用 `.mockResolvedValueOnce(...)` 覆盖。
 */
export function createMockPreloadAPI(): MockPreloadAPI {
  const transcriptListeners = new Set<(env: TranscriptEventEnvelope) => void>();
  const lifecycleListeners = new Set<(event: SessionLifecycleEvent) => void>();
  const portListeners = new Set<(p: ReadonlyArray<SerialPortInfo>) => void>();
  const uiPatchListeners = new Set<(patch: UiStatePatch) => void>();

  const session = {
    create: vi.fn(async () => okEmpty({ sessionId: 'sess_test', state: 'open' as const })),
    write: vi.fn(async () => okEmpty({ bytesWritten: 0 })),
    read: vi.fn(async () =>
      okEmpty<SessionReadSuccess>({
        events: [],
        cursor: 0,
        truncated: false,
        oldestAvailableSequence: 0,
      }),
    ),
    clear: vi.fn(async () => okEmpty({ sequence: 0 })),
    list: vi.fn(async () => okEmpty<{ sessions: ReadonlyArray<SessionSummary> }>({ sessions: [] })),
    status: vi.fn(async () =>
      okEmpty({ sessionId: 'sess_test', state: 'open' as const, latestCursor: 0 }),
    ),
    resize: vi.fn(async () => okEmpty({ resized: true })),
    destroy: vi.fn(async () => okEmpty({ destroyed: true as const })),
    onLifecycle: (handler: (event: SessionLifecycleEvent) => void): Unsubscribe => {
      lifecycleListeners.add(handler);
      return () => lifecycleListeners.delete(handler);
    },
    subscribe: vi.fn(async () =>
      okEmpty<TranscriptSubscribeSuccess>({
        events: [],
        cursor: 0,
        truncated: false,
        oldestAvailableSequence: 0,
      }),
    ),
  };

  const rttLogOpen = vi.fn(async () =>
    okEmpty({ sessionId: 'sess_rtt', state: 'open' as const, reused: false }),
  );

  const serialListPorts = vi.fn(
    async (): Promise<PreloadResult<ReadonlyArray<SerialPortInfo>>> => okEmpty([]),
  );

  const connectionList = vi.fn(
    async (): Promise<PreloadResult<ReadonlyArray<SavedConnectionSummary>>> => okEmpty([]),
  );
  const connectionSaveAndOpen = vi.fn(async () =>
    okEmpty({
      profile: {
        id: 'conn_test',
        label: 'Saved connection',
        type: 'serial',
        config: { type: 'serial', port: 'COM1', baudRate: 115200, mode: 'terminal' },
        hasCredential: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      } satisfies SavedConnectionSummary,
      sessionId: 'sess_test',
      state: 'open' as const,
    }),
  );
  const connectionOpen = vi.fn(async () =>
    okEmpty({
      profile: {
        id: 'conn_test',
        label: 'Saved connection',
        type: 'serial',
        config: { type: 'serial', port: 'COM1', baudRate: 115200, mode: 'terminal' },
        hasCredential: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      } satisfies SavedConnectionSummary,
      sessionId: 'sess_test',
      state: 'open' as const,
    }),
  );
  const connectionDelete = vi.fn(async () => okEmpty({ deleted: true as const }));

  const agentIntegrationList = vi.fn(
    async (): Promise<PreloadResult<ReadonlyArray<AgentIntegrationStatus>>> => okEmpty([]),
  );
  const agentIntegrationInstall = vi.fn(
    async (): Promise<PreloadResult<AgentIntegrationInstallResult>> =>
      okEmpty({
        status: {
          id: 'vscode',
          label: 'VS Code Copilot',
          configPath: 'mcp.json',
          configKind: 'vscode-mcp-json',
          status: 'configured',
          configured: true,
          canInstall: false,
        },
      }),
  );
  const agentIntegrationUninstall = vi.fn(
    async (): Promise<PreloadResult<AgentIntegrationUninstallResult>> =>
      okEmpty({
        status: {
          id: 'vscode',
          label: 'VS Code Copilot',
          configPath: 'mcp.json',
          configKind: 'vscode-mcp-json',
          status: 'not-configured',
          configured: false,
          canInstall: true,
        },
      }),
  );
  const agentIntegrationDiagnose = vi.fn(
    async (): Promise<PreloadResult<AgentIntegrationDiagnosticResult>> =>
      okEmpty({
        targetId: 'codex',
        label: 'Codex',
        transport: 'HTTP',
        checks: [{ id: 'config', label: 'Codex MCP config', status: 'pass' }],
      }),
  );

  const jlinkDeviceSearch = vi.fn(
    async (): Promise<PreloadResult<JLinkDeviceSearchResultPayload>> =>
      okEmpty({ available: false, reason: 'database-not-found', devices: [], sourceFiles: [] }),
  );
  const jlinkDeviceGet = vi.fn(async () => okEmpty({ device: undefined }));
  const jlinkDeviceRefresh = vi.fn(async () => okEmpty({ refreshed: true as const }));

  const defaultControlProfile: ControlProfileFilePayload = {
    schemaVersion: 'linkterm-control/1.0.0',
    serial: { enabled: true, port: 'COM1', baudRate: 115200, mode: 'terminal' },
    jlink: { enabled: false },
    flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
  };
  const controlProfileSave = vi.fn(async () =>
    okEmpty({ path: 'C:/repo/.linkterm/control-profile.json', profile: defaultControlProfile }),
  );
  const controlProfileLoad = vi.fn(async () =>
    okEmpty({ path: 'C:/repo/.linkterm/control-profile.json', profile: defaultControlProfile }),
  );
  const defaultControlProfileRecord: SavedControlProfileRecordPayload = {
    id: 'ctrl_test',
    label: 'repo - Saved control',
    root: 'C:/repo',
    source: 'manual',
    profile: defaultControlProfile,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const controlProfileListRecords = vi.fn(
    async (): Promise<PreloadResult<ReadonlyArray<SavedControlProfileRecordPayload>>> =>
      okEmpty([]),
  );
  const controlProfileOpenRecord = vi.fn(async () =>
    okEmpty({
      path: 'C:/repo/.linkterm/control-profile.json',
      record: defaultControlProfileRecord,
    }),
  );
  const controlProfileDeleteRecord = vi.fn(async () => okEmpty({ deleted: true as const }));
  const controlProfileRunDownload = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadResultPayload>> =>
      okEmpty({
        mode: 'flash-observe',
        root: 'C:/repo',
        steps: [],
        summary: {
          serialOpened: false,
          probeConnected: true,
          gdbServerStarted: false,
          flashed: true,
          verified: true,
          reset: false,
          serialObserved: false,
          rttObserved: false,
          debugCaptured: false,
        },
        nextActions: [],
      }),
  );
  const defaultControlProfileDownloadJob: ControlProfileDownloadJobPayload = {
    jobId: 'download_job_test',
    state: 'succeeded',
    mode: 'flash-observe',
    root: 'C:/repo',
    createdAt: 0,
    startedAt: 0,
    completedAt: 0,
    updatedAt: 0,
    cancelRequested: false,
    workflow: {
      mode: 'flash-observe',
      root: 'C:/repo',
      steps: [],
      summary: {
        serialOpened: false,
        probeConnected: true,
        gdbServerStarted: false,
        flashed: true,
        verified: true,
        reset: false,
        serialObserved: false,
        rttObserved: false,
        debugCaptured: false,
      },
      nextActions: [],
    },
  };
  const controlProfileStartDownload = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfileGetDownloadStatus = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfileReadDownload = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfilePickWorkspaceRoot = vi.fn(async () => okEmpty({ root: 'C:/repo' }));
  const controlProfilePickFirmwareFile = vi.fn(async () => okEmpty({ path: 'build/app.bin' }));

  const api: PreloadAPI = {
    session,
    rttLog: {
      open: rttLogOpen,
    },
    serial: {
      listPorts: serialListPorts,
      onPortChanged: (handler): Unsubscribe => {
        portListeners.add(handler);
        return () => portListeners.delete(handler);
      },
    },
    transcript: {
      onEvent: (handler): Unsubscribe => {
        transcriptListeners.add(handler);
        return () => transcriptListeners.delete(handler);
      },
    },
    ui: {
      onStatePatch: (handler): Unsubscribe => {
        uiPatchListeners.add(handler);
        return () => uiPatchListeners.delete(handler);
      },
    },
    connections: {
      list: connectionList,
      saveAndOpen: connectionSaveAndOpen,
      open: connectionOpen,
      delete: connectionDelete,
    },
    agentIntegrations: {
      list: agentIntegrationList,
      install: agentIntegrationInstall,
      uninstall: agentIntegrationUninstall,
      diagnose: agentIntegrationDiagnose,
    },
    jlinkDevices: {
      search: jlinkDeviceSearch,
      get: jlinkDeviceGet,
      refresh: jlinkDeviceRefresh,
    },
    controlProfile: {
      save: controlProfileSave,
      load: controlProfileLoad,
      listRecords: controlProfileListRecords,
      openRecord: controlProfileOpenRecord,
      deleteRecord: controlProfileDeleteRecord,
      runDownload: controlProfileRunDownload,
      startDownload: controlProfileStartDownload,
      getDownloadStatus: controlProfileGetDownloadStatus,
      readDownload: controlProfileReadDownload,
      pickWorkspaceRoot: controlProfilePickWorkspaceRoot,
      pickFirmwareFile: controlProfilePickFirmwareFile,
    },
  };

  return {
    api,
    emitTranscript: (envelope) => {
      for (const l of transcriptListeners) l(envelope);
    },
    emitSessionLifecycle: (event) => {
      for (const l of lifecycleListeners) l(event);
    },
    emitPortChange: (ports) => {
      for (const l of portListeners) l(ports);
    },
    emitUiPatch: (patch) => {
      for (const l of uiPatchListeners) l(patch);
    },
    spies: {
      session,
      rttLog: {
        open: rttLogOpen,
      },
      serial: {
        listPorts: serialListPorts,
      },
      connections: {
        list: connectionList,
        saveAndOpen: connectionSaveAndOpen,
        open: connectionOpen,
        delete: connectionDelete,
      },
      agentIntegrations: {
        list: agentIntegrationList,
        install: agentIntegrationInstall,
        uninstall: agentIntegrationUninstall,
        diagnose: agentIntegrationDiagnose,
      },
      jlinkDevices: {
        search: jlinkDeviceSearch,
        get: jlinkDeviceGet,
        refresh: jlinkDeviceRefresh,
      },
      controlProfile: {
        save: controlProfileSave,
        load: controlProfileLoad,
        listRecords: controlProfileListRecords,
        openRecord: controlProfileOpenRecord,
        deleteRecord: controlProfileDeleteRecord,
        runDownload: controlProfileRunDownload,
        startDownload: controlProfileStartDownload,
        getDownloadStatus: controlProfileGetDownloadStatus,
        readDownload: controlProfileReadDownload,
        pickWorkspaceRoot: controlProfilePickWorkspaceRoot,
        pickFirmwareFile: controlProfilePickFirmwareFile,
      },
    },
  };
}

/**
 * 注入 mock 到 `window.linkterm`，并返回控制器；clearable in afterEach.
 */
export function installMockPreload(): MockPreloadAPI {
  const mock = createMockPreloadAPI();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window.linkterm = mock.api;
  return mock;
}
