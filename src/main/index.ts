/**
 * Electron 主进程入口。
 *
 * 负责 BrowserWindow 生命周期 + IPC/MCP server 初始化与释放。
 *
 * 启动顺序：
 * 1. app.whenReady → registerIpcHandlers（创建 SessionManager；按 LINKTERM_MCP_STDIO 决定是否拉 MCP）
 * 2. createMainWindow（渲染端可立即通过 IPC 操作同一 SessionManager）
 *
 * 退出顺序（will-quit）：先 stop MCP，再 destroyAll session，最后释放 SerialDiscovery。
 *
 * 注意：MCP stdio 默认**不**自动启动 —— 桌面应用占用 stdout 会破坏 console.log
 * 与 Node 警告输出，进而污染 MCP JSON-RPC 帧。需要启用时设置 `LINKTERM_MCP_STDIO=1`。
 */
import { app, BrowserWindow } from 'electron';
import { createMainWindow, handleWindowClose } from './app-lifecycle.js';
import { registerIpcHandlers, type MainProcessContext } from './ipc/index.js';
import {
  isMcpStdioMode,
  shouldCreateMainWindow,
  shouldQuitForMissingSingleInstanceLock,
} from './startup-mode.js';

let mainWindow: BrowserWindow | null = null;
let context: MainProcessContext | null = null;

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
const singleInstanceLock = mcpStdioMode ? false : app.requestSingleInstanceLock();

if (shouldQuitForMissingSingleInstanceLock({
  hasSingleInstanceLock: singleInstanceLock,
  isMcpStdioMode: mcpStdioMode,
})) {
  app.quit();
} else {
  if (singleInstanceLock) {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
  }

  app.whenReady().then(async () => {
    context = await registerIpcHandlers({ getMainWindow });
    if (shouldCreateMainWindow({
      hasSingleInstanceLock: singleInstanceLock,
      isMcpStdioMode: mcpStdioMode,
    })) {
      mainWindow = createMainWindow();

      mainWindow.on('closed', () => {
        mainWindow = null;
      });

      handleWindowClose(mainWindow);
    }
  });

  app.on('window-all-closed', () => {
    // macOS 习惯：所有窗口关闭后应用仍驻留 Dock，由用户显式 quit
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', (event) => {
    if (!context) return;
    // dispose 是异步：阻塞 quit 等待 MCP server / 所有 session 干净关闭
    event.preventDefault();
    const ctx = context;
    context = null;
    ctx
      .dispose()
      .catch(() => undefined)
      .finally(() => app.quit());
  });

  app.on('activate', () => {
    // macOS 习惯：Dock 图标点击时若无窗口则重建一个
    if (!mcpStdioMode && !mainWindow) {
      mainWindow = createMainWindow();
      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    }
  });
}
