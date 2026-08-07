import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { electron } from '../electron-runtime.js';
import { readCurrentControlProfileDeploymentEvidence } from './current-deployment-evidence.js';
import { ActivityHealthMonitor } from '../../core/activity/activity-health.js';
import { OperationLedger } from '../../core/activity/operation-ledger.js';
import { AuditStore } from '../../core/activity/audit-store.js';
import {
  OperationRecorder,
  type OperationRecorderProvider,
} from '../../core/activity/operation-recorder.js';
import { RuntimeReadinessService } from '../../core/readiness/runtime-readiness-service.js';
import { findStableSerialIdentity } from '../../core/readiness/serial-identity.js';
import { JLinkVcomRecoveryService } from '../../core/recovery/jlink-vcom-recovery-service.js';
import { OperationAdmissionCoordinator } from '../../core/operation-admission/operation-admission-coordinator.js';
import {
  createAgentIntegrationProvider,
  createCompensationSummaryProvider,
  createFirmwareReadinessProvider,
  createJLinkReadinessProvider,
  createReusableSessionsProvider,
  createRttReadinessProvider,
  createRuntimeStatusProvider,
  createSerialDiscoveryProvider,
  createWorkspaceProfileProvider,
  type FirmwareReadinessMetadata,
  type JLinkReadinessProbeSummary,
  type RttReadinessConfig,
} from '../../core/readiness/readiness-providers.js';
import {
  CompensationCandidateService,
  type VerifiedDeploymentEvidence,
} from '../../core/compensation/index.js';
import { SessionManager } from '../../core/session/session-manager.js';
import { SerialSessionCoordinator } from '../../core/session/serial-session-coordinator.js';
import {
  ControlProfileManager,
  ControlProfileRecordManager,
  WorkspaceConfigManager,
} from '../../core/workspace/index.js';
import { ConnectionProfileManager } from '../../core/connections/index.js';
import {
  AgentIntegrationManager,
  buildElectronMcpLaunchConfig,
  type LinkTermMcpLaunchConfig,
} from '../../core/agent-integrations/index.js';
import { createWslAgentConfigFileBridge } from './wsl-agent-config-file-bridge.js';
import { JLinkAdapter, createJLinkDeviceCatalog } from '../../jlink/index.js';
import type { IJLinkBackend, JLinkDeviceCatalog, ProbeInfo } from '../../jlink/index.js';
import { createMcpServer, type LinkTermMcpServer } from '../../mcp/index.js';
import {
  startMcpHttpRuntimeServer,
  type McpHttpRuntimeServer,
} from '../../mcp/http-runtime-server.js';
import {
  createRuntimeDiagnosticsProvider,
  type RuntimeDiagnosticsProvider,
} from '../../mcp/runtime-diagnostics.js';
import {
  readOrCreateRuntimeHttpSettings,
  runtimeHttpSettingsPath,
  runtimeMetadataPath,
  writeRuntimeHttpSettings,
} from '../../mcp/runtime-metadata.js';
import { ControlWorkflowJobManager } from '../../mcp/surfaces/control-workflow/job-manager.js';
import type { CapturableWindow } from '../../mcp/surfaces/ui/types.js';
import type {
  RuntimeRestartRequest,
  RuntimeRestartScheduler,
} from '../../mcp/surfaces/runtime-control/tools.js';
import { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import { registerSerialIpc } from './serial-ipc.js';
import { registerSessionIpc } from './session-ipc.js';
import { registerSessionCreate } from './session-create-handler.js';
import { registerRttLogSessionIpc } from './rtt-log-session-ipc.js';
import { registerJLinkDeviceCatalogIpc } from './jlink-device-catalog-ipc.js';
import { registerConnectionProfilesIpc } from './connection-profiles-ipc.js';
import { registerAgentIntegrationsIpc } from './agent-integrations-ipc.js';
import { buildDefaultAgentIntegrationTargets } from './agent-integration-targets.js';
import { createCodexTokenEnvWriter } from './codex-token-env.js';
import { registerControlProfileIpc } from './control-profile-ipc.js';
import { registerActivityIpc } from './activity-ipc.js';
import { registerAuditIpc } from './audit-ipc.js';
import { registerReadinessIpc } from './readiness-ipc.js';
import { registerFirstSignalIpc } from './first-signal-ipc.js';
import { createAndOpenSession } from './session-open-helper.js';
import {
  FirstSignalObservationService,
  type FirstSignalObservableSession,
} from '../../core/session/first-signal-observation/first-signal-observation-service.js';
import { SafeStorageSecretCodec } from '../connections/safe-storage-secret-codec.js';
import { createUiBridge } from './ui-bridge.js';
export { createUiBridge, type UiPatchTarget } from './ui-bridge.js';

const { app, BrowserWindow: ElectronBrowserWindow } = electron;

/**
 * 主进程持有的全局依赖容器：随 IPC handler 一起初始化、随退出统一清理。
 *
 * **关键不变量（§4.5）**：`sessionManager` 必须由 IPC 层与 MCP server 共享同一实例 ——
 * 这是 \"AI 与人操作同一会话\" 的物理基础。`mcpServer` 在创建时被注入这个 manager，
 * 因此本 context 同时持有二者并在 dispose 时按 \"先 stop MCP → 再 destroyAll session\" 顺序释放。
 *
 * Phase 8 新增 `workspaceConfigManager`：MCP `init/get/update_workspace_config` 三工具与之共享。
 */
export interface MainProcessContext {
  serialDiscovery: SerialDiscovery;
  sessionManager: SessionManager;
  workspaceConfigManager: WorkspaceConfigManager;
  controlProfileManager: ControlProfileManager;
  controlProfileRecordManager: ControlProfileRecordManager;
  connectionProfileManager: ConnectionProfileManager;
  /** 本机 Agent MCP 配置检测与安装管理器。 */
  agentIntegrationManager: AgentIntegrationManager;
  /**
   * Phase 9：J-Link backend。当前仅 lifecycle 可用（probeConnect/disconnect/status
   * /detect），其余方法抛 NOT_IMPLEMENTED；Phase 13+ 替换为真实 SEGGER 适配器。
   */
  jlinkBackend: IJLinkBackend;
  /** 本机 SEGGER J-Link 设备库搜索/校验服务。 */
  jlinkDeviceCatalog: JLinkDeviceCatalog;
  /** 控制工作流后台 job 管理器，必须在 HTTP 短生命周期 MCP server 间共享。 */
  controlWorkflowJobManager: ControlWorkflowJobManager;
  /** Main-owned activity ledger；renderer 只通过 activity IPC 读取 display-safe DTO。 */
  operationLedger: OperationLedger;
  /** Main-owned best-effort durable activity projection; raw paths and authority stay private. */
  auditStore: AuditStore;
  /** Main-owned runtime readiness service；renderer 只通过 readiness IPC 读取 display-safe DTO。 */
  runtimeReadinessService: RuntimeReadinessService;
  /** Main-owned first-signal observation service；renderer 只通过 firstSignal IPC 读取 display-safe DTO。 */
  firstSignalObservationService: FirstSignalObservationService;
  /** Main-only admission coordinator；execution leases 不跨 preload。 */
  operationAdmissionCoordinator: OperationAdmissionCoordinator;
  mcpServer: LinkTermMcpServer;
  /** 本地 HTTP MCP endpoint，供后启动的 stdio proxy 连接到同一 runtime。 */
  mcpHttpServer: McpHttpRuntimeServer;
  /** 反注册所有 IPC handler 并停止 MCP server / 销毁所有 session；应用退出/测试 teardown 调用。 */
  dispose: () => Promise<void>;
}

/**
 * {@link registerIpcHandlers} 的可选项。
 *
 * `autoStartMcp` 控制是否在 register 阶段就启动 MCP server：
 * - `true`: 立即启动（CI / 测试可显式开启）
 * - `false`: 不启动；调用方稍后自行 `mcpServer.start()`
 * - `undefined`（默认）: 依据环境变量 `LINKTERM_MCP_STDIO==='1'` 决定。
 *   桌面默认不自动占用 stdio —— 否则任何 console.log / Node warning 都会
 *   破坏 MCP 协议帧，并污染 Electron 主进程的标准输出。
 */
export interface RegisterIpcHandlersOptions {
  /** 是否在创建 context 后立即启动 MCP server。 */
  autoStartMcp?: boolean;
  /**
   * Phase 10：当前主窗口 thunk。注入后 MCP `ui_screenshot` 可以拿到 BrowserWindow
   * 调用 `webContents.capturePage()`；缺省时 ui_screenshot 一律 UI_NOT_AVAILABLE。
   *
   * 必须是 thunk —— 详见 `src/main/index.ts` `getMainWindow` JSDoc.
   */
  getMainWindow?: () => BrowserWindow | null;
}

/**
 * 注册所有主进程 ↔ 渲染进程的 IPC handler，并返回拥有所有 main-side 状态的 context.
 *
 * 启动失败保证：MCP server 启动抛错时，已注册的 IPC handler 会被回滚 ——
 * 否则下次 register 会撞 `ipcMain.handle` 的 \"already registered\".
 *
 * @param options 可选行为开关
 * @returns 包含 sessionManager / mcpServer 的 context；调用方应在退出时 await dispose()
 */
export async function registerIpcHandlers(
  options: RegisterIpcHandlersOptions = {},
): Promise<MainProcessContext> {
  const serialDiscovery = new SerialDiscovery();
  const sessionManager = new SessionManager();
  const serialSessionCoordinator = new SerialSessionCoordinator(sessionManager);
  const workspaceConfigManager = new WorkspaceConfigManager({
    evidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
  });
  const controlProfileManager = new ControlProfileManager();
  const controlProfileRecordManager = new ControlProfileRecordManager({
    filePath: path.join(app.getPath('userData'), 'control-profiles.json'),
  });
  const connectionProfileManager = new ConnectionProfileManager({
    filePath: path.join(app.getPath('userData'), 'connections.json'),
    secretCodec: new SafeStorageSecretCodec(),
  });
  const linkTermMcpLaunchConfig = buildLinkTermMcpLaunchConfig();
  const httpSettingsPath = runtimeHttpSettingsPath(app.getPath('userData'));
  const httpSettings = await readOrCreateRuntimeHttpSettings(httpSettingsPath);
  process.env.LINKTERM_MCP_TOKEN = httpSettings.token;
  const jlinkAdapter = new JLinkAdapter();
  const jlinkBackend: IJLinkBackend = jlinkAdapter;
  const jlinkVcomRecoveryService = new JLinkVcomRecoveryService({
    controlProfileManager,
    recordManager: controlProfileRecordManager,
    serialDiscovery,
    jlinkBackend,
    vcomControl: jlinkAdapter,
    openSerial: async ({ port, baudRate, mode, label }) =>
      createAndOpenSession(
        sessionManager,
        { type: 'serial', port, baudRate, mode },
        label,
        serialSessionCoordinator,
      ),
  });
  const jlinkDeviceCatalog = createJLinkDeviceCatalog();
  const activityHealth = new ActivityHealthMonitor();
  const operationLedger = new OperationLedger({ health: activityHealth });
  const auditStore = new AuditStore({
    directory: path.join(app.getPath('userData'), 'activity'),
    onWarning: () => activityHealth.recordCaptureFailure('provider', 'capture-failed', 0),
  });
  await auditStore.initialize();
  const unsubscribeAudit = operationLedger.subscribe((event) => auditStore.enqueue(event));
  const operationRecorder = new OperationRecorder({
    ledger: operationLedger,
    health: activityHealth,
  });
  const compensationCandidateService = new CompensationCandidateService();
  const onVerifiedDeployment = (evidence: VerifiedDeploymentEvidence): void => {
    compensationCandidateService.recordDeployment(evidence);
  };
  const controlWorkflowJobManager = new ControlWorkflowJobManager({
    observer: (observation) => operationRecorder.observeWorkflowJob(observation),
  });
  const operationRecorderProvider: OperationRecorderProvider = (input) =>
    operationRecorder.beginMcpCall(input);

  const uiBridge = createUiBridge(() =>
    ElectronBrowserWindow.getAllWindows().map((w) => w.webContents),
  );

  const getMainWindow = options.getMainWindow;
  const getActiveWindow: () => CapturableWindow | null = getMainWindow
    ? () => {
        const win = getMainWindow();
        return win && !win.isDestroyed() ? win : null;
      }
    : () => null;

  const metadataPath = runtimeMetadataPath(app.getPath('userData'));
  const ownerRuntimeDiagnostics = createRuntimeDiagnosticsProvider({
    transportMode: 'http-owner',
    metadataPath,
    artifactPaths: runtimeFreshnessArtifactPaths(),
  });
  const directStdioRuntimeDiagnostics = createRuntimeDiagnosticsProvider({
    transportMode: 'direct-stdio',
    metadataPath,
    artifactPaths: runtimeFreshnessArtifactPaths(),
  });
  const runtimeRestartScheduler = createElectronRuntimeRestartScheduler();
  const firstSignalObservationService = new FirstSignalObservationService({
    resolveSession: (sessionId) => {
      const session = sessionManager.get(sessionId);
      return isFirstSignalObservableSession(session) ? session : undefined;
    },
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    createAttemptId: () => `attempt_${randomUUID()}`,
    terminalRetentionMs: 30_000,
  });
  const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
    runtimeId: `operation_admission_runtime_${randomUUID().replaceAll('-', '')}`,
    now: () => new Date().toISOString(),
    createLeaseId: () => `lease_${randomUUID().replaceAll('-', '')}`,
  });
  const mcpServer = createMcpServer({
    sessionManager,
    serialSessionCoordinator,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlProfileRecordManager,
    controlWorkflowJobManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: directStdioRuntimeDiagnostics,
    runtimeRestartScheduler,
    operationRecorderProvider,
    operationAdmissionCoordinator,
    onVerifiedDeployment,
  });

  const mcpHttpServer = await startMcpHttpRuntimeServer({
    sessionManager,
    serialSessionCoordinator,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlProfileRecordManager,
    controlWorkflowJobManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: ownerRuntimeDiagnostics,
    runtimeRestartScheduler,
    operationRecorderProvider,
    operationAdmissionCoordinator,
    onVerifiedDeployment,
    metadataPath,
    host: httpSettings.host,
    port: httpSettings.port,
    token: httpSettings.token,
  });

  if (mcpHttpServer.port !== httpSettings.port) {
    try {
      await writeRuntimeHttpSettings(httpSettingsPath, {
        ...httpSettings,
        port: mcpHttpServer.port,
      });
    } catch (err) {
      await mcpHttpServer.close().catch(() => undefined);
      throw err;
    }
  }

  const agentIntegrationManager = new AgentIntegrationManager({
    targets: await buildDefaultAgentIntegrationTargets({
      appData: app.getPath('appData'),
      appRoot: app.getAppPath(),
      home: app.getPath('home'),
      launchConfig: linkTermMcpLaunchConfig,
      httpTransport: {
        url: `http://localhost:${mcpHttpServer.port}/mcp`,
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }),
    launchConfig: linkTermMcpLaunchConfig,
    wslFiles: createWslAgentConfigFileBridge(),
    tokenEnvWriter: createCodexTokenEnvWriter(),
  });
  const runtimeReadinessService = createRuntimeReadinessService({
    runtimeDiagnostics: ownerRuntimeDiagnostics,
    serialDiscovery,
    sessionManager,
    controlProfileManager,
    controlProfileRecordManager,
    agentIntegrationManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    compensationCandidateService,
  });

  const unregisterSerial = registerSerialIpc(serialDiscovery);
  const unregisterSession = registerSessionIpc(sessionManager);
  const unregisterSessionCreate = registerSessionCreate(sessionManager, serialSessionCoordinator);
  const unregisterRttLogSession = registerRttLogSessionIpc(
    sessionManager,
    jlinkBackend,
    controlProfileManager,
    jlinkDeviceCatalog,
  );
  const unregisterConnectionProfiles = registerConnectionProfilesIpc(
    sessionManager,
    connectionProfileManager,
    jlinkBackend,
    controlProfileManager,
    jlinkDeviceCatalog,
    undefined,
    serialSessionCoordinator,
    async (portPath) => findStableSerialIdentity(portPath, await serialDiscovery.listPorts()),
  );
  const unregisterAgentIntegrations = registerAgentIntegrationsIpc(agentIntegrationManager);
  const unregisterControlProfile = registerControlProfileIpc(
    controlProfileManager,
    controlProfileRecordManager,
    {
      sessionManager,
      jlinkBackend,
      jlinkDeviceCatalog,
      controlWorkflowJobManager,
      compensationCandidateService,
      onVerifiedDeployment,
      serialSessionCoordinator,
      serialDiscovery,
      jlinkVcomRecoveryService,
    },
  );
  const unregisterJLinkDeviceCatalog = registerJLinkDeviceCatalogIpc(jlinkDeviceCatalog);
  const unregisterActivity = registerActivityIpc(operationLedger);
  const unregisterAudit = registerAuditIpc({
    auditStore,
    isTrustedSender: (senderId) => {
      const win = options.getMainWindow?.();
      return (
        win !== undefined && win !== null && !win.isDestroyed() && win.webContents.id === senderId
      );
    },
  });
  const unregisterReadiness = registerReadinessIpc(runtimeReadinessService);
  const unregisterFirstSignal = registerFirstSignalIpc(firstSignalObservationService);
  const shouldAutoStart = options.autoStartMcp ?? process.env.LINKTERM_MCP_STDIO === '1';
  if (shouldAutoStart) {
    try {
      await mcpServer.start();
    } catch (err) {
      // 回滚已注册的 IPC handler 与 SerialDiscovery，避免重复 register / handler 泄漏
      unregisterSerial();
      unregisterSession();
      unregisterSessionCreate();
      unregisterRttLogSession();
      unregisterConnectionProfiles();
      unregisterAgentIntegrations();
      unregisterControlProfile();
      unregisterJLinkDeviceCatalog();
      unregisterActivity();
      unregisterAudit();
      unregisterReadiness();
      unregisterFirstSignal();
      await mcpHttpServer.close().catch(() => undefined);
      serialDiscovery.dispose();
      unsubscribeAudit();
      await auditStore.dispose().catch(() => undefined);
      throw err;
    }
  }

  const dispose = async (): Promise<void> => {
    unregisterSerial();
    unregisterSession();
    unregisterSessionCreate();
    unregisterRttLogSession();
    unregisterConnectionProfiles();
    unregisterAgentIntegrations();
    unregisterControlProfile();
    unregisterJLinkDeviceCatalog();
    unregisterActivity();
    unregisterAudit();
    unregisterReadiness();
    unregisterFirstSignal();
    firstSignalObservationService.shutdown();
    // 先停 MCP，避免 destroyAll 期间还有新工具调用进来
    await mcpServer.stop().catch(() => undefined);
    await mcpHttpServer.close().catch(() => undefined);
    await sessionManager.destroyAll().catch(() => undefined);
    serialDiscovery.dispose();
    unsubscribeAudit();
    await auditStore.dispose().catch(() => undefined);
  };

  return {
    serialDiscovery,
    sessionManager,
    workspaceConfigManager,
    controlProfileManager,
    controlProfileRecordManager,
    connectionProfileManager,
    agentIntegrationManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    controlWorkflowJobManager,
    operationLedger,
    auditStore,
    runtimeReadinessService,
    firstSignalObservationService,
    operationAdmissionCoordinator,
    mcpServer,
    mcpHttpServer,
    dispose,
  };
}

function isFirstSignalObservableSession(
  session: ReturnType<SessionManager['get']>,
): session is FirstSignalObservableSession {
  return (
    session !== undefined && typeof (session as FirstSignalObservableSession).off === 'function'
  );
}

function createRuntimeReadinessService(input: {
  readonly runtimeDiagnostics: RuntimeDiagnosticsProvider;
  readonly serialDiscovery: SerialDiscovery;
  readonly sessionManager: SessionManager;
  readonly controlProfileManager: ControlProfileManager;
  readonly controlProfileRecordManager: ControlProfileRecordManager;
  readonly agentIntegrationManager: AgentIntegrationManager;
  readonly jlinkBackend: IJLinkBackend;
  readonly jlinkDeviceCatalog: JLinkDeviceCatalog;
  readonly compensationCandidateService: CompensationCandidateService;
}): RuntimeReadinessService {
  return new RuntimeReadinessService({
    providers: [
      createRuntimeStatusProvider({
        getStatus: async () => {
          const diagnostics = await input.runtimeDiagnostics();
          return {
            codeFresh: diagnostics.code?.fresh !== false,
            runtimeFresh: diagnostics.metadata.fresh,
          };
        },
      }),
      createSerialDiscoveryProvider({
        listPorts: () => input.serialDiscovery.listPorts(),
        savedProfiles: async () => {
          try {
            const records = await input.controlProfileRecordManager.list();
            return records.map((record) => ({
              id: record.id,
              label: record.label,
              portLabel: record.profile.serial?.port,
              baudRate: record.profile.serial?.baudRate,
              hardwareIdentity: record.profile.serial?.hardwareIdentity,
              parentIdentity: record.profile.serial?.parentIdentity,
            }));
          } catch {
            return [];
          }
        },
      }),
      createReusableSessionsProvider({
        listSessions: async () => input.sessionManager.listSummaries(),
      }),
      createWorkspaceProfileProvider({
        listProfiles: async () => {
          const records = await input.controlProfileRecordManager.list();
          return records.map((record) => ({
            id: record.id,
            label: record.label,
            root: record.root,
          }));
        },
      }),
      createJLinkReadinessProvider({
        detectProbes: async () =>
          (await input.jlinkBackend.probeDetect()).map(projectJLinkReadinessProbe),
        targetName: async () => readSavedJLinkTarget(input.controlProfileRecordManager),
        hasTargetInCatalog: async (targetName) => input.jlinkDeviceCatalog.has(targetName),
      }),
      createFirmwareReadinessProvider({
        readFirmwareMetadata: async () =>
          readSavedFirmwareMetadata(input.controlProfileRecordManager),
      }),
      createRttReadinessProvider({
        readRttConfig: async () => readSavedRttConfig(input.controlProfileRecordManager),
      }),
      createCompensationSummaryProvider({
        summaries: async () => {
          const root = input.compensationCandidateService.activeCandidateWorkspaceRoot();
          const currentEvidence =
            root === null
              ? undefined
              : await readCurrentControlProfileDeploymentEvidence(
                  input.controlProfileManager,
                  root,
                );
          return input.compensationCandidateService.summaries({ currentEvidence });
        },
        profileSuggestions: () => input.compensationCandidateService.profileSuggestions(),
      }),
      createAgentIntegrationProvider({
        listAgents: async () => {
          const statuses = await input.agentIntegrationManager.listStatuses();
          return statuses.map((status) => ({
            id: status.id,
            label: status.label,
            installed: status.configured,
            diagnosticCode: 'readiness.agent.integration_missing',
          }));
        },
      }),
    ],
  });
}

function projectJLinkReadinessProbe(probe: ProbeInfo): JLinkReadinessProbeSummary {
  const maybeLabel = (probe as { readonly label?: unknown }).label;
  return {
    probeId: probe.probeId,
    label: typeof maybeLabel === 'string' && maybeLabel.trim() !== '' ? maybeLabel : 'J-Link probe',
    target: probe.target,
    connected: probe.connected,
  };
}

async function readSavedJLinkTarget(
  manager: ControlProfileRecordManager,
): Promise<string | undefined> {
  const record = (await manager.list()).find(
    (item) => item.profile.jlink?.enabled === true && item.profile.jlink.target !== undefined,
  );
  return record?.profile.jlink?.target;
}

async function readSavedFirmwareMetadata(
  manager: ControlProfileRecordManager,
): Promise<FirmwareReadinessMetadata | undefined> {
  const record = (await manager.list()).find(
    (item) =>
      item.profile.flash?.binary !== undefined && item.profile.flash.baseAddress !== undefined,
  );
  const flash = record?.profile.flash;
  if (record === undefined || flash?.binary === undefined || flash.baseAddress === undefined) {
    return undefined;
  }

  const firmwarePath = resolveWorkspaceChildPath(record.root, flash.binary);
  const baseAddress = parseReadinessHexAddress(flash.baseAddress);
  if (firmwarePath === undefined || baseAddress === undefined) return undefined;

  const safeFirmwarePath = await resolveWorkspaceRealChildPath(record.root, firmwarePath);
  if (safeFirmwarePath === undefined) return undefined;

  const firmwareStat = await stat(safeFirmwarePath);
  if (!firmwareStat.isFile()) return undefined;
  return {
    displayName: flash.binary,
    byteLength: firmwareStat.size,
    format: firmwareFormatForPath(flash.binary),
    baseAddress,
    verify: flash.verify ?? true,
  };
}

async function readSavedRttConfig(
  manager: ControlProfileRecordManager,
): Promise<RttReadinessConfig | undefined> {
  const record = (await manager.list()).find((item) => item.profile.rtt?.enabled === true);
  const rtt = record?.profile.rtt;
  if (rtt?.enabled !== true) return undefined;
  return {
    channelIndex: rtt.channels?.[0] ?? 0,
    maxBytes: 4096,
    timeoutMs: 15_000,
    markers: [],
  };
}

function resolveWorkspaceChildPath(root: string, childPath: string): string | undefined {
  const trimmed = childPath.trim();
  if (trimmed === '') return undefined;
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, trimmed);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

async function resolveWorkspaceRealChildPath(
  root: string,
  resolvedChildPath: string,
): Promise<string | undefined> {
  try {
    const realRoot = await realpath(root);
    const realChild = await realpath(resolvedChildPath);
    return isPathInside(realRoot, realChild) ? realChild : undefined;
  } catch {
    return undefined;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseReadinessHexAddress(value: string): number | undefined {
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function firmwareFormatForPath(filePath: string): FirmwareReadinessMetadata['format'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.bin') return 'bin';
  if (extension === '.hex') return 'hex';
  if (extension === '.elf') return 'elf';
  return 'unknown';
}

/**
 * Build the stdio launch command external Agents should use to start LinkTerm MCP.
 *
 * @returns Launch configuration with MCP stdio enabled.
 */
function buildLinkTermMcpLaunchConfig(): LinkTermMcpLaunchConfig {
  return buildElectronMcpLaunchConfig({
    runtimePath: process.execPath,
    metadataPath: runtimeMetadataPath(app.getPath('userData')),
    launcherPath: electronRuntimeLauncherPath(),
    appPath: app.isPackaged ? undefined : app.getAppPath(),
  });
}

/**
 * Resolve the compiled launcher script used to clear Electron Node-mode before MCP runtime startup.
 *
 * @returns Absolute path to the launcher script in development or packaged builds.
 */
function electronRuntimeLauncherPath(): string {
  const relativeLauncherPath = path.join('dist', 'main', 'mcp', 'electron-runtime-launcher.js');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', relativeLauncherPath)
    : path.join(app.getAppPath(), relativeLauncherPath);
}

function runtimeFreshnessArtifactPaths(): string[] {
  return runtimeFreshnessArtifactPathsForApp({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  });
}

export function runtimeFreshnessArtifactPathsForApp(input: {
  appPath: string;
  isPackaged: boolean;
  relativeFiles?: readonly string[];
}): string[] {
  if (input.isPackaged) return [];
  const relativeFiles =
    input.relativeFiles ?? listRuntimeArtifactFiles(path.join(input.appPath, 'dist', 'main'));
  return relativeFiles
    .filter((filePath) => filePath.startsWith('dist/main/') && filePath.endsWith('.js'))
    .map((filePath) => path.join(input.appPath, ...filePath.split('/')));
}

function listRuntimeArtifactFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.relative(path.dirname(path.dirname(root)), fullPath).replace(/\\/g, '/'));
      }
    }
  };
  visit(root);
  return files;
}

let runtimeRestartScheduled = false;

function createElectronRuntimeRestartScheduler(): RuntimeRestartScheduler {
  return (request: RuntimeRestartRequest) => {
    if (runtimeRestartScheduled) {
      return {
        scheduled: true,
        delayMs: request.delayMs,
        mode: 'electron-relaunch',
        alreadyScheduled: true,
        message: 'A LinkTerm MCP runtime restart is already scheduled.',
      };
    }

    runtimeRestartScheduled = true;
    app.relaunch();
    const timer = setTimeout(() => app.exit(0), request.delayMs);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    return {
      scheduled: true,
      delayMs: request.delayMs,
      mode: 'electron-relaunch',
    };
  };
}
