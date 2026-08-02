/**
 * 类型化的 `window.linkterm` mock 工厂。
 *
 * 每个 renderer 测试在 beforeEach 调用 `installMockPreload()`，得到一个可观察 mock；
 * 测试用 `mock.session.create.mockResolvedValueOnce(...)` 配置预期返回值。
 */

import { vi } from 'vitest';
import type {
  ActivityEventView,
  ActivitySnapshotView,
} from '../../src/shared/activity-contract.js';
import type { AuditStoreStatus } from '../../src/shared/audit-contract.js';
import {
  READINESS_SCHEMA_VERSION,
  RuntimeReadinessSnapshotSchema,
  type ReadinessEvent,
  type RuntimeReadinessSnapshot,
} from '../../src/shared/readiness-contract.js';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalEventSchema,
  FirstSignalObservationSchema,
  type FirstSignalEvent,
  type FirstSignalObservation,
  type FirstSignalStartResult,
} from '../../src/shared/first-signal-contract.js';
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
  ControlProfileChipProbePayload,
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
  /** 测试可调用此函数让下一次 activity.subscribe 保持 pending，并手动 resolve/reject。 */
  deferActivitySubscribe(): MockDeferred<PreloadResult<ActivitySnapshotView>>;
  /** 测试可调用此函数让下一次 readiness.refresh 保持 pending，并手动 resolve/reject。 */
  deferReadinessRefresh(): MockDeferred<PreloadResult<RuntimeReadinessSnapshot>>;
  /** 测试可调用此函数让下一次 firstSignal.start 保持 pending，并手动 resolve/reject。 */
  deferFirstSignalStart(): MockDeferred<FirstSignalStartResult>;
  /** 构造确定性的 Runtime Readiness snapshot。 */
  readinessSnapshot(
    generation?: number,
    status?: RuntimeReadinessSnapshot['status'],
  ): RuntimeReadinessSnapshot;
  /** 构造确定性的 First Signal observation。 */
  firstSignalObservation(overrides?: Partial<FirstSignalObservation>): FirstSignalObservation;
  /** 设置 readiness.get/subscribe 默认返回的当前 snapshot。 */
  setReadinessSnapshot(snapshot: RuntimeReadinessSnapshot): void;
  /** 设置 firstSignal.status/subscribe 默认返回的当前 observation。 */
  setFirstSignalObservation(observation: FirstSignalObservation): void;
  /** 测试可调用此函数模拟主进程推送 transcript 事件。 */
  emitTranscript(envelope: TranscriptEventEnvelope): void;
  /** 测试可调用此函数模拟主进程推送 session 生命周期事件。 */
  emitSessionLifecycle(event: SessionLifecycleEvent): void;
  /** 测试可调用此函数模拟串口插拔变化。 */
  emitPortChange(ports: ReadonlyArray<SerialPortInfo>): void;
  /** 测试可调用此函数模拟主进程推送 activity 事件。 */
  emitActivityEvent(event: ActivityEventView): void;
  /** 测试可调用此函数模拟主进程推送 readiness 事件。 */
  emitReadinessEvent(snapshot: RuntimeReadinessSnapshot): void;
  /** 测试可调用此函数模拟主进程推送 first-signal event。 */
  emitFirstSignalEvent(observation: FirstSignalObservation): void;
  /** 测试可调用此函数模拟 preload 收到 malformed first-signal push payload。 */
  emitInvalidFirstSignalPayload(payload: unknown): void;
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
    activity: {
      subscribe: ReturnType<typeof vi.fn>;
      snapshot: ReturnType<typeof vi.fn>;
      unsubscribe: ReturnType<typeof vi.fn>;
      status: ReturnType<typeof vi.fn>;
      export: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
    readiness: {
      get: ReturnType<typeof vi.fn>;
      refresh: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      unsubscribe: ReturnType<typeof vi.fn>;
    };
    firstSignal: {
      start: ReturnType<typeof vi.fn>;
      status: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      unsubscribe: ReturnType<typeof vi.fn>;
    };
    connections: {
      list: ReturnType<typeof vi.fn>;
      saveAndOpen: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateAndOpen: ReturnType<typeof vi.fn>;
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
      recoverJlinkVcom: ReturnType<typeof vi.fn>;
      runDownload: ReturnType<typeof vi.fn>;
      startDownload: ReturnType<typeof vi.fn>;
      startCompensationReflash: ReturnType<typeof vi.fn>;
      saveProfileSuggestion: ReturnType<typeof vi.fn>;
      getDownloadStatus: ReturnType<typeof vi.fn>;
      readDownload: ReturnType<typeof vi.fn>;
      connectChip: ReturnType<typeof vi.fn>;
      disconnectChip: ReturnType<typeof vi.fn>;
      pickWorkspaceRoot: ReturnType<typeof vi.fn>;
      pickFirmwareFile: ReturnType<typeof vi.fn>;
    };
  };
}

export interface MockDeferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const okEmpty = <T>(data: T): PreloadResult<T> => ({ success: true, data });

function createDeferred<T>(): MockDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createReadinessSnapshot(
  generation = 0,
  status: RuntimeReadinessSnapshot['status'] = 'ready',
): RuntimeReadinessSnapshot {
  const checkedAt = `2026-07-13T03:00:${String(generation).padStart(2, '0')}.000Z`;
  return RuntimeReadinessSnapshotSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshotId: `readiness_${generation}`,
    generation,
    status,
    generatedAt: checkedAt,
    checks: [
      {
        id: 'runtime',
        scope: 'runtime',
        status,
        severity: status === 'ready' ? 'info' : 'warning',
        summaryCode: status === 'ready' ? 'readiness.runtime.ready' : 'readiness.runtime.stale',
        evidence: [],
        recommendedActions: [],
        checkedAt,
      },
    ],
    deviceCandidates: [],
    reusableSessions: [],
    reusableProfiles: [],
    blockers: [],
    diagnostics: [],
  });
}

function createFirstSignalObservation(
  overrides: Partial<FirstSignalObservation> = {},
): FirstSignalObservation {
  const revision = overrides.revision ?? 1;
  const state = overrides.state ?? 'waiting';
  return FirstSignalObservationSchema.parse({
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    attemptId: 'attempt_1',
    clientAttemptKey: 'client_1',
    revision,
    sessionId: 'sess_test',
    ownsSession: true,
    baselineCursor: 0,
    state,
    startedAt: '2026-07-13T06:00:00.000Z',
    updatedAt: `2026-07-13T06:00:${String(revision).padStart(2, '0')}.000Z`,
    timeoutMs: 1_000,
    ...(state === 'signal-detected'
      ? {
          observedAt: '2026-07-13T06:00:02.000Z',
          observedSequence: overrides.observedSequence ?? 1,
        }
      : {}),
    ...(state === 'silent'
      ? {
          silentSince: overrides.silentSince ?? '2026-07-13T06:00:01.000Z',
        }
      : {}),
    ...(state === 'closed'
      ? {
          closedReason: overrides.closedReason ?? 'session-closed',
        }
      : {}),
    ...(state === 'stopped'
      ? {
          stopReason: overrides.stopReason ?? 'user',
        }
      : {}),
    ...(state === 'errored'
      ? {
          error: overrides.error ?? {
            code: 'firstSignal.monitor_failed',
            messageCode: 'firstSignal.error.monitorFailed',
            stage: 'monitor',
          },
        }
      : {}),
    ...overrides,
  });
}

/**
 * 构造 PreloadAPI mock.
 *
 * 默认所有方法返回 `{success:true, data:{}}` 占位；具体测试用 `.mockResolvedValueOnce(...)` 覆盖。
 */
export function createMockPreloadAPI(): MockPreloadAPI {
  const transcriptListeners = new Set<(env: TranscriptEventEnvelope) => void>();
  const lifecycleListeners = new Set<(event: SessionLifecycleEvent) => void>();
  const portListeners = new Set<(p: ReadonlyArray<SerialPortInfo>) => void>();
  const activityListeners = new Set<(event: ActivityEventView) => void>();
  const readinessListeners = new Set<(event: ReadinessEvent) => void>();
  const firstSignalListeners = new Set<(event: FirstSignalEvent) => void>();
  const firstSignalInvalidPayloadListeners = new Set<
    (diagnostic: {
      readonly code: 'firstSignal.invalid_payload';
      readonly severity: 'error';
    }) => void
  >();
  const uiPatchListeners = new Set<(patch: UiStatePatch) => void>();
  let currentReadinessSnapshot = createReadinessSnapshot();
  let currentFirstSignalObservation = createFirstSignalObservation();

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
  const emptyActivitySnapshot: ActivitySnapshotView = {
    schemaVersion: '1.0.0',
    cursor: { runtimeId: 'runtime_test', sequence: 0 },
    truncated: false,
    resetRequired: false,
    events: [],
    operations: [],
    calls: [],
    health: {
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 0,
      listenerFailureCount: 0,
      policyFailureCount: 0,
      incompleteLifecycleCount: 0,
    },
  };
  const activitySubscribe = vi.fn(async () => okEmpty(emptyActivitySnapshot));
  const activitySnapshot = vi.fn(async () => okEmpty(emptyActivitySnapshot));
  const activityUnsubscribe = vi.fn(async () => okEmpty({ unsubscribed: true as const }));
  const emptyAuditStatus: AuditStoreStatus = {
    schemaVersion: '1.0.0',
    enabled: true,
    retentionDays: 30,
    maxFileBytes: 10 * 1024 * 1024,
    eventCount: 0,
    fileCount: 0,
    byteCount: 0,
    warningCount: 0,
    warnings: [],
    windowsAclDefault: true,
  };
  const activityStatus = vi.fn(async () => okEmpty({ status: emptyAuditStatus }));
  const activityExport = vi.fn(async () =>
    okEmpty({
      schemaVersion: '1.0.0' as const,
      fileName: 'activity-export-test.jsonl',
      format: 'jsonl' as const,
      pathMode: 'basename' as const,
      eventCount: 0,
      redacted: true as const,
    }),
  );
  const activityClear = vi.fn(async () =>
    okEmpty({ schemaVersion: '1.0.0' as const, cleared: true as const, deletedFileCount: 0 }),
  );
  const readinessGet = vi.fn(async () => okEmpty(currentReadinessSnapshot));
  const readinessRefresh = vi.fn(async () => {
    currentReadinessSnapshot = createReadinessSnapshot(currentReadinessSnapshot.generation + 1);
    return okEmpty(currentReadinessSnapshot);
  });
  const readinessSubscribe = vi.fn(async () => okEmpty(currentReadinessSnapshot));
  const readinessUnsubscribe = vi.fn(async () => okEmpty({ unsubscribed: true as const }));
  const firstSignalStart = vi.fn(async () => okEmpty(currentFirstSignalObservation));
  const firstSignalStatus = vi.fn(async () => okEmpty(currentFirstSignalObservation));
  const firstSignalStop = vi.fn(async () => okEmpty(currentFirstSignalObservation));
  const firstSignalSubscribe = vi.fn(async () => okEmpty(currentFirstSignalObservation));
  const firstSignalUnsubscribe = vi.fn(async () => okEmpty({ unsubscribed: true as const }));
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
  const connectionUpdate = vi.fn(async () =>
    okEmpty({
      id: 'conn_test',
      label: 'Saved connection',
      type: 'serial',
      config: { type: 'serial', port: 'COM1', baudRate: 115200, mode: 'terminal' },
      hasCredential: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(1).toISOString(),
    } satisfies SavedConnectionSummary),
  );
  const connectionUpdateAndOpen = vi.fn(async () =>
    okEmpty({
      profile: {
        id: 'conn_test',
        label: 'Saved connection',
        type: 'serial',
        config: { type: 'serial', port: 'COM1', baudRate: 115200, mode: 'terminal' },
        hasCredential: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(1).toISOString(),
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
  const controlProfileRecoverJlinkVcom = vi.fn(async () =>
    okEmpty({
      status: 'power-cycle-required' as const,
      record: defaultControlProfileRecord,
      firmwareUpdateObserved: false,
    }),
  );
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
    cancellationCapability: 'best-effort',
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
  const controlProfileStartCompensationReflash = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfileSaveProfileSuggestion = vi.fn(async () =>
    okEmpty({
      path: 'C:/repo/.linkterm/control-profile.json',
      profile: defaultControlProfile,
      record: defaultControlProfileRecord,
    }),
  );
  const controlProfileGetDownloadStatus = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfileReadDownload = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty(defaultControlProfileDownloadJob),
  );
  const controlProfileCancelDownload = vi.fn(
    async (): Promise<PreloadResult<ControlProfileDownloadJobPayload>> =>
      okEmpty({
        ...defaultControlProfileDownloadJob,
        state: 'running',
        cancelRequested: true,
        stopState: 'stop-requested',
      }),
  );
  const controlProfileConnectChip = vi.fn(
    async (): Promise<PreloadResult<{ probe: ControlProfileChipProbePayload }>> =>
      okEmpty({
        probe: {
          probeId: '11111111-1111-4111-8111-111111111111',
          target: 'STM32H743II',
          connected: true,
        },
      }),
  );
  const controlProfileDisconnectChip = vi.fn(
    async (): Promise<PreloadResult<{ probeId: string; disconnected: true }>> =>
      okEmpty({
        probeId: '11111111-1111-4111-8111-111111111111',
        disconnected: true,
      }),
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
    activity: {
      subscribe: activitySubscribe,
      snapshot: activitySnapshot,
      unsubscribe: activityUnsubscribe,
      status: activityStatus,
      export: activityExport,
      clear: activityClear,
      onEvent: (handler): Unsubscribe => {
        activityListeners.add(handler);
        return () => activityListeners.delete(handler);
      },
    },
    readiness: {
      get: readinessGet,
      refresh: readinessRefresh,
      subscribe: readinessSubscribe,
      unsubscribe: readinessUnsubscribe,
      onEvent: (handler): Unsubscribe => {
        readinessListeners.add(handler);
        return () => readinessListeners.delete(handler);
      },
    },
    firstSignal: {
      start: firstSignalStart,
      status: firstSignalStatus,
      stop: firstSignalStop,
      subscribe: firstSignalSubscribe,
      unsubscribe: firstSignalUnsubscribe,
      onEvent: (handler, onInvalidPayload): Unsubscribe => {
        firstSignalListeners.add(handler);
        if (onInvalidPayload) firstSignalInvalidPayloadListeners.add(onInvalidPayload);
        return () => {
          firstSignalListeners.delete(handler);
          if (onInvalidPayload) firstSignalInvalidPayloadListeners.delete(onInvalidPayload);
        };
      },
    },
    connections: {
      list: connectionList,
      saveAndOpen: connectionSaveAndOpen,
      update: connectionUpdate,
      updateAndOpen: connectionUpdateAndOpen,
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
      recoverJlinkVcom: controlProfileRecoverJlinkVcom,
      runDownload: controlProfileRunDownload,
      startDownload: controlProfileStartDownload,
      startCompensationReflash: controlProfileStartCompensationReflash,
      saveProfileSuggestion: controlProfileSaveProfileSuggestion,
      getDownloadStatus: controlProfileGetDownloadStatus,
      readDownload: controlProfileReadDownload,
      cancelDownload: controlProfileCancelDownload,
      connectChip: controlProfileConnectChip,
      disconnectChip: controlProfileDisconnectChip,
      pickWorkspaceRoot: controlProfilePickWorkspaceRoot,
      pickFirmwareFile: controlProfilePickFirmwareFile,
    },
  };

  return {
    api,
    deferActivitySubscribe: () => {
      const pending = createDeferred<PreloadResult<ActivitySnapshotView>>();
      activitySubscribe.mockReturnValueOnce(pending.promise);
      return pending;
    },
    deferReadinessRefresh: () => {
      const pending = createDeferred<PreloadResult<RuntimeReadinessSnapshot>>();
      readinessRefresh.mockReturnValueOnce(pending.promise);
      return pending;
    },
    deferFirstSignalStart: () => {
      const pending = createDeferred<FirstSignalStartResult>();
      firstSignalStart.mockReturnValueOnce(pending.promise);
      return pending;
    },
    readinessSnapshot: createReadinessSnapshot,
    firstSignalObservation: createFirstSignalObservation,
    setReadinessSnapshot: (snapshot) => {
      currentReadinessSnapshot = snapshot;
    },
    setFirstSignalObservation: (observation) => {
      currentFirstSignalObservation = observation;
    },
    emitTranscript: (envelope) => {
      for (const l of transcriptListeners) l(envelope);
    },
    emitSessionLifecycle: (event) => {
      for (const l of lifecycleListeners) l(event);
    },
    emitPortChange: (ports) => {
      for (const l of portListeners) l(ports);
    },
    emitActivityEvent: (event) => {
      for (const l of activityListeners) l(event);
    },
    emitReadinessEvent: (snapshot) => {
      const event: ReadinessEvent = {
        schemaVersion: READINESS_SCHEMA_VERSION,
        snapshot,
      };
      for (const l of readinessListeners) l(event);
    },
    emitFirstSignalEvent: (observation) => {
      const event = FirstSignalEventSchema.parse({
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        observation,
      });
      for (const l of firstSignalListeners) l(event);
    },
    emitInvalidFirstSignalPayload: () => {
      for (const l of firstSignalInvalidPayloadListeners) {
        l({ code: 'firstSignal.invalid_payload', severity: 'error' });
      }
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
      activity: {
        subscribe: activitySubscribe,
        snapshot: activitySnapshot,
        unsubscribe: activityUnsubscribe,
        status: activityStatus,
        export: activityExport,
        clear: activityClear,
      },
      readiness: {
        get: readinessGet,
        refresh: readinessRefresh,
        subscribe: readinessSubscribe,
        unsubscribe: readinessUnsubscribe,
      },
      firstSignal: {
        start: firstSignalStart,
        status: firstSignalStatus,
        stop: firstSignalStop,
        subscribe: firstSignalSubscribe,
        unsubscribe: firstSignalUnsubscribe,
      },
      connections: {
        list: connectionList,
        saveAndOpen: connectionSaveAndOpen,
        update: connectionUpdate,
        updateAndOpen: connectionUpdateAndOpen,
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
        recoverJlinkVcom: controlProfileRecoverJlinkVcom,
        runDownload: controlProfileRunDownload,
        startDownload: controlProfileStartDownload,
        startCompensationReflash: controlProfileStartCompensationReflash,
        saveProfileSuggestion: controlProfileSaveProfileSuggestion,
        getDownloadStatus: controlProfileGetDownloadStatus,
        readDownload: controlProfileReadDownload,
        cancelDownload: controlProfileCancelDownload,
        connectChip: controlProfileConnectChip,
        disconnectChip: controlProfileDisconnectChip,
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
