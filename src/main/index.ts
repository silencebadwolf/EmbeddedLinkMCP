/**
 * Electron 主进程入口。
 *
 * 仅负责 BrowserWindow 生命周期；具体业务（IPC handler 注册、SessionManager、MCP server 启动）
 * 在 Phase 5 引入并由本文件协调。
 */
import { app, BrowserWindow } from 'electron';
import { createMainWindow, handleWindowClose } from './app-lifecycle.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  handleWindowClose(mainWindow);
});

app.on('window-all-closed', () => {
  // macOS 习惯：所有窗口关闭后应用仍驻留 Dock，由用户显式 quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS 习惯：Dock 图标点击时若无窗口则重建一个
  if (!mainWindow) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }
});
