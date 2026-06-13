import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const IS_DEV = !app.isPackaged;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'LinkTerm v2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

export function handleWindowClose(_win: BrowserWindow): void {
  // Placeholder for window close handling logic
}
