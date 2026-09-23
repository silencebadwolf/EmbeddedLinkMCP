/** Electron transport adapter for shared runtime client services. */
import { registerFirstSignalIpc as registerService } from '@linkterm/runtime/services/client/first-signal-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/first-signal-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerFirstSignalIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
