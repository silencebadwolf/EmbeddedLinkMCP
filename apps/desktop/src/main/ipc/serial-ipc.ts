/** Electron transport adapter for shared runtime client services. */
import { registerSerialIpc as registerService } from '@linkterm/runtime/services/client/serial-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/serial-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerSerialIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
