/** Electron transport adapter for shared runtime client services. */
import { registerSessionCreate as registerService } from '@linkterm/runtime/services/client/session-create-handler';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/session-create-handler';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerSessionCreate(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
