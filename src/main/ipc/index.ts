import {
  startMcpHttpRuntimeServer,
  type McpHttpRuntimeServer,
} from '@linkterm/mcp/http-runtime-server';
import { createMcpServer, type LinkTermMcpServer } from '@linkterm/mcp/index';
import {
  createRuntimeDiagnosticsProvider,
  type RuntimeDiagnosticsProvider,
} from '@linkterm/mcp/runtime-diagnostics';
import {
  readOrCreateRuntimeHttpSettings,
  runtimeHttpSettingsPath,
  runtimeMetadataPath,
  writeRuntimeHttpSettings,
} from '@linkterm/mcp/runtime-metadata';
import { ControlWorkflowJobManager } from '@linkterm/mcp/surfaces/control-workflow/job-manager';
import type {
  RuntimeRestartRequest,
  RuntimeRestartScheduler,
} from '@linkterm/mcp/surfaces/runtime-control/tools';
import type { CapturableWindow } from '@linkterm/mcp/surfaces/ui/types';
import { createRuntime, type Runtime } from '@linkterm/runtime';
import { AuditStore } from '@linkterm/runtime/core/activity/audit-store';
import { OperationLedger } from '@linkterm/runtime/core/activity/operation-ledger';
import {
  AgentIntegrationManager,
  buildElectronMcpLaunchConfig,
  type LinkTermMcpLaunchConfig,
} from '@linkterm/runtime/core/agent-integrations/index';
import { ConnectionProfileManager } from '@linkterm/runtime/core/connections/index';
import { OperationAdmissionCoordinator } from '@linkterm/runtime/core/operation-admission/operation-admission-coordinator';
import { RuntimeReadinessService } from '@linkterm/runtime/core/readiness/runtime-readiness-service';
import { findStableSerialIdentity } from '@linkterm/runtime/core/readiness/serial-identity';
import { FirstSignalObservationService } from '@linkterm/runtime/core/session/first-signal-observation/first-signal-observation-service';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import {
  ControlProfileManager,
  ControlProfileRecordManager,
  WorkspaceConfigManager,
} from '@linkterm/runtime/core/workspace/index';
import type { IJLinkBackend, JLinkDeviceCatalog } from '@linkterm/runtime/jlink/index';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import type { BrowserWindow } from 'electron';
import type { Dirent } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { SafeStorageSecretCodec } from '../connections/safe-storage-secret-codec.js';
import { electron } from '../electron-runtime.js';
import { createDesktopNativeBindings } from '../native-bindings.js';
import { registerActivityIpc } from './activity-ipc.js';
import { buildDefaultAgentIntegrationTargets } from './agent-integration-targets.js';
import { registerAgentIntegrationsIpc } from './agent-integrations-ipc.js';
import { registerAuditIpc } from './audit-ipc.js';
import { createCodexTokenEnvWriter } from './codex-token-env.js';
import { registerConnectionProfilesIpc } from './connection-profiles-ipc.js';
import { registerControlProfileIpc } from './control-profile-ipc.js';
import { registerFirstSignalIpc } from './first-signal-ipc.js';
import { registerJLinkDeviceCatalogIpc } from './jlink-device-catalog-ipc.js';
import { registerReadinessIpc } from './readiness-ipc.js';
import { registerRttLogSessionIpc } from './rtt-log-session-ipc.js';
import { registerSerialIpc } from './serial-ipc.js';
import { registerSessionCreate } from './session-create-handler.js';
import { registerSessionIpc } from './session-ipc.js';
import { createUiBridge } from './ui-bridge.js';
import { createWslAgentConfigFileBridge } from './wsl-agent-config-file-bridge.js';
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
export interface MainProcessContext extends Runtime {
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
  const linkTermMcpLaunchConfig = buildLinkTermMcpLaunchConfig();
  const dataDir = app.getPath('userData');
  const httpSettingsPath = runtimeHttpSettingsPath(dataDir);
  const httpSettings = await readOrCreateRuntimeHttpSettings(httpSettingsPath);
  process.env.LINKTERM_MCP_TOKEN = httpSettings.token;
  let agentIntegrationManager: AgentIntegrationManager | undefined;
  let ownerRuntimeDiagnostics: RuntimeDiagnosticsProvider | undefined;
  const runtime = await createRuntime({
    dataDir,
    nativeBindings: createDesktopNativeBindings(),
    secretCodec: new SafeStorageSecretCodec(),
    agentIntegrations: {
      listStatuses: () => agentIntegrationManager?.listStatuses() ?? Promise.resolve([]),
    },
    getRuntimeStatus: async () => {
      const diagnostics = await ownerRuntimeDiagnostics?.();
      return {
        codeFresh: diagnostics?.code?.fresh !== false,
        runtimeFresh: diagnostics?.metadata.fresh ?? true,
      };
    },
  });
  const unregister: Array<() => void> = [];
  let mcpServer: LinkTermMcpServer | undefined;
  let mcpHttpServer: McpHttpRuntimeServer | undefined;
  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      const failures: unknown[] = [];
      for (const off of unregister.splice(0).reverse()) {
        try {
          off();
        } catch (error) {
          failures.push(error);
        }
      }
      const stopped = await Promise.allSettled([mcpServer?.stop(), mcpHttpServer?.close()]);
      for (const result of stopped) if (result.status === 'rejected') failures.push(result.reason);
      try {
        await runtime.dispose();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Desktop runtime disposal failed');
    })();
    return disposePromise;
  };
  try {
    const uiBridge = createUiBridge(() =>
      ElectronBrowserWindow.getAllWindows().map((w) => w.webContents),
    );
    const getActiveWindow: () => CapturableWindow | null = () => {
      const win = options.getMainWindow?.();
      return win && !win.isDestroyed() ? win : null;
    };
    const metadataPath = runtimeMetadataPath(dataDir);
    ownerRuntimeDiagnostics = createRuntimeDiagnosticsProvider({
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
    const commonMcpOptions = { ...runtime, uiBridge, getActiveWindow, runtimeRestartScheduler };
    mcpServer = createMcpServer({
      ...commonMcpOptions,
      runtimeDiagnostics: directStdioRuntimeDiagnostics,
    });
    mcpHttpServer = await startMcpHttpRuntimeServer({
      ...commonMcpOptions,
      runtimeDiagnostics: ownerRuntimeDiagnostics,
      metadataPath,
      host: httpSettings.host,
      port: httpSettings.port,
      token: httpSettings.token,
    });
    if (mcpHttpServer.port !== httpSettings.port) {
      await writeRuntimeHttpSettings(httpSettingsPath, {
        ...httpSettings,
        port: mcpHttpServer.port,
      });
    }
    agentIntegrationManager = new AgentIntegrationManager({
      targets: await buildDefaultAgentIntegrationTargets({
        appData: app.getPath('appData'),
        appRoot: app.getAppPath(),
        home: app.getPath('home'),
        launchConfig: linkTermMcpLaunchConfig,
        httpTransport: {
          url: 'http://localhost:' + mcpHttpServer.port + '/mcp',
          bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
        },
      }),
      launchConfig: linkTermMcpLaunchConfig,
      wslFiles: createWslAgentConfigFileBridge(),
      tokenEnvWriter: createCodexTokenEnvWriter(),
    });
    const {
      serialDiscovery,
      sessionManager,
      serialSessionCoordinator,
      controlProfileManager,
      controlProfileRecordManager,
      connectionProfileManager,
      jlinkBackend,
      jlinkDeviceCatalog,
      controlWorkflowJobManager,
      compensationCandidateService,
      onVerifiedDeployment,
      jlinkVcomRecoveryService,
      operationLedger,
      auditStore,
      runtimeReadinessService,
      firstSignalObservationService,
    } = runtime;
    unregister.push(registerSerialIpc(serialDiscovery));
    unregister.push(registerSessionIpc(sessionManager));
    unregister.push(registerSessionCreate(sessionManager, serialSessionCoordinator));
    unregister.push(
      registerRttLogSessionIpc(
        sessionManager,
        jlinkBackend,
        controlProfileManager,
        jlinkDeviceCatalog,
      ),
    );
    unregister.push(
      registerConnectionProfilesIpc(
        sessionManager,
        connectionProfileManager,
        jlinkBackend,
        controlProfileManager,
        jlinkDeviceCatalog,
        undefined,
        serialSessionCoordinator,
        async (portPath) => findStableSerialIdentity(portPath, await serialDiscovery.listPorts()),
      ),
    );
    unregister.push(registerAgentIntegrationsIpc(agentIntegrationManager));
    unregister.push(
      registerControlProfileIpc(controlProfileManager, controlProfileRecordManager, {
        sessionManager,
        jlinkBackend,
        jlinkDeviceCatalog,
        controlWorkflowJobManager,
        compensationCandidateService,
        onVerifiedDeployment,
        serialSessionCoordinator,
        serialDiscovery,
        jlinkVcomRecoveryService,
      }),
    );
    unregister.push(registerJLinkDeviceCatalogIpc(jlinkDeviceCatalog));
    unregister.push(registerActivityIpc(operationLedger));
    unregister.push(
      registerAuditIpc({
        auditStore,
        isTrustedSender: (senderId) => {
          const win = options.getMainWindow?.();
          return (
            win !== undefined &&
            win !== null &&
            !win.isDestroyed() &&
            win.webContents.id === senderId
          );
        },
      }),
    );
    unregister.push(registerReadinessIpc(runtimeReadinessService));
    unregister.push(registerFirstSignalIpc(firstSignalObservationService));
    if (options.autoStartMcp ?? process.env.LINKTERM_MCP_STDIO === '1') await mcpServer.start();
    return { ...runtime, agentIntegrationManager, mcpServer, mcpHttpServer, dispose };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
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
