/** Electron exposes only the typed client; the transport stays in the isolated preload. */
import { createClientAPI } from '@linkterm/contracts/create-client';
import { electron } from '../platform/electron-runtime.js';
const { contextBridge, ipcRenderer } = electron;
contextBridge.exposeInMainWorld(
  'linkterm',
  createClientAPI({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    on: (channel, listener) => {
      ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
      ipcRenderer.removeListener(channel, listener);
    },
  }),
);
