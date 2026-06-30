/**
 * Electron 主进程入口。
 *
 * 负责 BrowserWindow 生命周期 + IPC/MCP server 初始化与释放。
 *
 * 启动顺序：
 * 1. app.whenReady → registerIpcHandlers（创建 SessionManager；按 LINKTERM_MCP_STDIO 决定是否拉 MCP）
 * 2. createMainWindow（渲染端可立即通过 IPC 操作同一 SessionManager）
 *
 * 退出顺序（will-quit）：先 stop MCP，再 destroyAll session，最后释放 SerialDiscovery.
 *
 * 注意：MCP stdio 默认**不**自动启动 —— 桌面应用占用 stdout 会破坏 console.log
 * 与 Node 警告输出，进而污染 MCP JSON-RPC 帧。需要启用时设置 `LINKTERM_MCP_STDIO=1`。
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import { electron } from './electron-runtime.js';
import { createMainWindow, handleWindowClose } from './app-lifecycle.js';
import { registerIpcHandlers, type MainProcessContext } from './ipc/index.js';
import {
  isMcpStdioMode,
  shouldCreateMainWindow,
  shouldQuitForMissingSingleInstanceLock,
} from './startup-mode.js';
import { runtimeMetadataPath } from '../mcp/runtime-metadata.js';
import { startMcpStdioProxy, type McpStdioProxy } from '../mcp/stdio-proxy.js';
import { waitForHealthyRuntimeMetadata } from '../mcp/electron-runtime-launcher-core.js';

const { app } = electron;

let mainWindow: BrowserWindow | null = null;
let context: MainProcessContext | null = null;
let stdioProxy: McpStdioProxy | null = null;
let ownerStdioDisconnected = false;
let proxyStdioDisconnected = false;

const RUNTIME_METADATA_WAIT_MS = 3_000;
const RUNTIME_METADATA_RETRY_MS = 100;

/**
 * 主窗口 thunk —— Phase 10 MCP UI 工具通过此 getter 拿到当前活跃窗口。
 *
 * 必须每次调用都从模块作用域读最新引用：MCP server 在 mainWindow 创建之前构造，
 * 且 macOS `'activate'` 重建会替换变量；构造时快照会指向已 destroy 的旧窗口。
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

const mcpStdioMode = isMcpStdioMode(process.env);
const singleInstanceLock = app.requestSingleInstanceLock({ mcpStdioMode });

if (!singleInstanceLock && mcpStdioMode) {
  installProxyShutdownHooks();
  app.whenReady()
    .then(async () => {
      if (proxyStdioDisconnected) {
        await stopProxyAndQuit();
        return;
      }
      await startProxyToExistingRuntime();
      if (proxyStdioDisconnected) {
        await stopProxyAndQuit();
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`${message}\n`);
      app.quit();
    });
} else if (shouldQuitForMissingSingleInstanceLock({
  hasSingleInstanceLock: singleInstanceLock,
  isMcpStdioMode: mcpStdioMode,
})) {
  app.quit();
} else {
  if (singleInstanceLock) {
    app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
      const data = additionalData as { mcpStdioMode?: boolean } | undefined;
      if (data?.mcpStdioMode) return;
      focusOrCreateMainWindow();
    });
  }

  app.whenReady().then(async () => {
    if (mcpStdioMode) {
      installOwnerStdioShutdownHooks();
      if (ownerStdioDisconnected) {
        await stopOwnerStdioAfterDisconnect();
        return;
      }
    }
    context = await registerIpcHandlers({ getMainWindow });
    if (ownerStdioDisconnected) {
      await stopOwnerStdioAfterDisconnect();
      return;
    }
    if (shouldCreateMainWindow({
      hasSingleInstanceLock: singleInstanceLock,
      isMcpStdioMode: mcpStdioMode,
    })) {
      focusOrCreateMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    // macOS 习惯：所有窗口关闭后应用仍驻留 Dock，由用户显式 quit
    if (process.platform !== 'darwin' && !mcpStdioMode) {
      app.quit();
    }
  });

  app.on('will-quit', (event) => {
    if (!context && !stdioProxy) return;
    // dispose 是异步：阻塞 quit 等待 MCP server / proxy / 所有 session 干净关闭
    event.preventDefault();
    const ctx = context;
    const proxy = stdioProxy;
    context = null;
    stdioProxy = null;
    Promise.all([
      ctx?.dispose().catch(() => undefined),
      proxy?.stop().catch(() => undefined),
    ])
      .catch(() => undefined)
      .finally(() => app.quit());
  });

  app.on('activate', () => {
    // macOS 习惯：Dock 图标点击时若无窗口则重建一个
    if (!mcpStdioMode && !mainWindow) {
      focusOrCreateMainWindow();
    }
  });
}

/** Create the main window if needed, otherwise focus the existing one. */
function focusOrCreateMainWindow(): void {
  const currentWindow = mainWindow;
  if (!currentWindow) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    handleWindowClose(mainWindow);
    return;
  }
  if (currentWindow.isMinimized()) currentWindow.restore();
  currentWindow.focus();
}

/** Start stdio proxy mode and attach to the runtime metadata written by the lock owner. */
async function startProxyToExistingRuntime(): Promise<void> {
  const metadataPath = runtimeMetadataPath(app.getPath('userData'));
  const metadata = await waitForHealthyRuntimeMetadata({
    metadataPath,
    timeoutMs: RUNTIME_METADATA_WAIT_MS,
    retryMs: RUNTIME_METADATA_RETRY_MS,
    delay,
  });
  if (!metadata) {
    throw new Error('LinkTerm MCP runtime metadata is unavailable or unhealthy; start LinkTerm once to initialize MCP.');
  }
  stdioProxy = await startMcpStdioProxy(metadata);
}

/** Install shutdown hooks for MCP-owner Electron instances. */
function installOwnerStdioShutdownHooks(): void {
  const disconnect = (): void => {
    ownerStdioDisconnected = true;
    void stopOwnerStdioAfterDisconnect();
  };
  const terminate = (): void => {
    void stopOwnerStdioAndQuit();
  };
  process.stdin.once('end', disconnect);
  process.stdin.once('close', disconnect);
  process.stdin.once('error', disconnect);
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
}

/** Stop the direct stdio MCP server and quit the owner process. */
async function stopOwnerStdioAndQuit(): Promise<void> {
  await context?.mcpServer.stop().catch(() => undefined);
  app.quit();
}

/** Stop the direct stdio MCP server; quit only when no UI window is attached. */
async function stopOwnerStdioAfterDisconnect(): Promise<void> {
  const ctx = context;
  if (!ctx) {
    app.quit();
    return;
  }
  await ctx.mcpServer.stop().catch(() => undefined);
  if (!mainWindow) {
    app.quit();
  }
}

/** Install shutdown hooks for proxy-only Electron instances. */
function installProxyShutdownHooks(): void {
  const shutdown = (): void => {
    proxyStdioDisconnected = true;
    void stopProxyAndQuit();
  };
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.stdin.once('error', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

/** Stop the stdio proxy exactly once and quit the proxy-only process. */
async function stopProxyAndQuit(): Promise<void> {
  const proxy = stdioProxy;
  if (!proxy) {
    app.quit();
    return;
  }
  stdioProxy = null;
  await proxy.stop().catch(() => undefined);
  app.quit();
}
