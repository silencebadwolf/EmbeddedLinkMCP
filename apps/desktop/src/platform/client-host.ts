import type { ClientServiceHost } from '@linkterm/runtime/services/client/ports';
import { electron } from './electron-runtime.js';
import { chooseFirmwareFile, chooseWorkspaceRoot } from './file-selection.js';

/** All window and IPC authority remains in the desktop host. */
export const desktopClientHost: ClientServiceHost = {
  requests: {
    handle: (method, handler) => electron.ipcMain.handle(method, handler),
    removeHandler: (method) => electron.ipcMain.removeHandler(method),
  },
  getPeers: () => electron.BrowserWindow.getAllWindows().map((window) => window.webContents),
  chooseWorkspaceRoot,
  chooseFirmwareFile,
};
