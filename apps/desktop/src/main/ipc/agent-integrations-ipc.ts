/** Electron transport adapter for shared runtime client services. */
import { registerAgentIntegrationsIpc as registerService } from '@linkterm/runtime/services/client/agent-integrations-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/agent-integrations-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerAgentIntegrationsIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
