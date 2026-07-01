import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { electron } from '../electron-runtime.js';
import { SessionManager } from '../../core/session/session-manager.js';
import { ControlProfileManager, WorkspaceConfigManager } from '../../core/workspace/index.js';
import { ConnectionProfileManager } from '../../core/connections/index.js';
import {
  AgentIntegrationManager,
  buildElectronMcpLaunchConfig,
  type LinkTermMcpLaunchConfig,
} from '../../core/agent-integrations/index.js';
import { createWslAgentConfigFileBridge } from './wsl-agent-config-file-bridge.js';
import { JLinkAdapter, createJLinkDeviceCatalog } from '../../jlink/index.js';
import type { IJLinkBackend, JLinkDeviceCatalog } from '../../jlink/index.js';
import { createMcpServer, type LinkTermMcpServer } from '../../mcp/index.js';
import { startMcpHttpRuntimeServer, type McpHttpRuntimeServer } from '../../mcp/http-runtime-server.js';
import { createRuntimeDiagnosticsProvider } from '../../mcp/runtime-diagnostics.js';
import {
  readOrCreateRuntimeHttpSettings,
  runtimeHttpSettingsPath,
  runtimeMetadataPath,
} from '../../mcp/runtime-metadata.js';
import { ControlWorkflowJobManager } from '../../mcp/surfaces/control-workflow/job-manager.js';
import type { CapturableWindow } from '../../mcp/surfaces/ui/types.js';
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
  const workspaceConfigManager = new WorkspaceConfigManager({
    evidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
  });
  const controlProfileManager = new ControlProfileManager();
  const connectionProfileManager = new ConnectionProfileManager({
    filePath: path.join(app.getPath('userData'), 'connections.json'),
    secretCodec: new SafeStorageSecretCodec(),
  });
  const linkTermMcpLaunchConfig = buildLinkTermMcpLaunchConfig();
  const httpSettings = await readOrCreateRuntimeHttpSettings(
    runtimeHttpSettingsPath(app.getPath('userData')),
  );
  process.env.LINKTERM_MCP_TOKEN = httpSettings.token;
  const agentIntegrationManager = new AgentIntegrationManager({
    targets: await buildDefaultAgentIntegrationTargets({
      appData: app.getPath('appData'),
      appRoot: app.getAppPath(),
      home: app.getPath('home'),
      launchConfig: linkTermMcpLaunchConfig,
      httpTransport: {
        url: `http://localhost:${httpSettings.port}/mcp`,
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }),
    launchConfig: linkTermMcpLaunchConfig,
    wslFiles: createWslAgentConfigFileBridge(),
    tokenEnvWriter: createCodexTokenEnvWriter(),
  });
  const jlinkBackend: IJLinkBackend = new JLinkAdapter();
  const jlinkDeviceCatalog = createJLinkDeviceCatalog();
  const controlWorkflowJobManager = new ControlWorkflowJobManager();

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

  const mcpServer = createMcpServer({
    sessionManager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlWorkflowJobManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: directStdioRuntimeDiagnostics,
  });

  const mcpHttpServer = await startMcpHttpRuntimeServer({
    sessionManager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlWorkflowJobManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: ownerRuntimeDiagnostics,
    metadataPath,
    port: httpSettings.port,
    token: httpSettings.token,
  });

  const unregisterSerial = registerSerialIpc(serialDiscovery);
  const unregisterSession = registerSessionIpc(sessionManager);
  const unregisterSessionCreate = registerSessionCreate(sessionManager);
  const unregisterRttLogSession = registerRttLogSessionIpc(
    sessionManager,
    jlinkBackend,
    controlProfileManager,
    jlinkDeviceCatalog,
  );
  const unregisterConnectionProfiles = registerConnectionProfilesIpc(
    sessionManager,
    connectionProfileManager,
  );
  const unregisterAgentIntegrations = registerAgentIntegrationsIpc(
    agentIntegrationManager,
  );
  const unregisterControlProfile = registerControlProfileIpc(controlProfileManager);
  const unregisterJLinkDeviceCatalog = registerJLinkDeviceCatalogIpc(jlinkDeviceCatalog);

  const shouldAutoStart =
    options.autoStartMcp ?? process.env.LINKTERM_MCP_STDIO === '1';
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
      await mcpHttpServer.close().catch(() => undefined);
      serialDiscovery.dispose();
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
    // 先停 MCP，避免 destroyAll 期间还有新工具调用进来
    await mcpServer.stop().catch(() => undefined);
    await mcpHttpServer.close().catch(() => undefined);
    await sessionManager.destroyAll().catch(() => undefined);
    serialDiscovery.dispose();
  };

  return {
    serialDiscovery,
    sessionManager,
    workspaceConfigManager,
    controlProfileManager,
    connectionProfileManager,
    agentIntegrationManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    controlWorkflowJobManager,
    mcpServer,
    mcpHttpServer,
    dispose,
  };
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
  const relativeFiles = input.relativeFiles ?? listRuntimeArtifactFiles(path.join(input.appPath, 'dist', 'main'));
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
