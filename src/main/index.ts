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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }
});
