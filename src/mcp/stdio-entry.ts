#!/usr/bin/env node
/** Standalone MCP stdio entry for external Agent hosts. */

import { SessionManager } from '../core/session/session-manager.js';
import { WorkspaceConfigManager } from '../core/workspace/index.js';
import { JLinkAdapter } from '../jlink/jlink-adapter.js';
import { createMcpServer } from './server.js';
import { SerialDiscovery } from '../transports/serial/serial-discovery.js';

const serialDiscovery = new SerialDiscovery();
const sessionManager = new SessionManager();
const workspaceConfigManager = new WorkspaceConfigManager({
  evidenceFn: async () => ({
    serialPorts: await serialDiscovery.listPorts(),
  }),
});

const mcpServer = createMcpServer({
  sessionManager,
  serialDiscovery,
  workspaceConfigManager,
  workspaceEvidenceFn: async () => ({
    serialPorts: await serialDiscovery.listPorts(),
  }),
  jlinkBackend: new JLinkAdapter(),
});

let shuttingDown = false;

/** Stop MCP and release runtime resources. */
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await mcpServer.stop();
  } finally {
    await sessionManager.destroyAll().catch(() => undefined);
    serialDiscovery.dispose();
  }
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
process.once('beforeExit', () => {
  void shutdown();
});

mcpServer.start().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
