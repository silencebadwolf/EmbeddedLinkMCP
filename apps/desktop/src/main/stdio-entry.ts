#!/usr/bin/env node
/** Standalone MCP stdio entry for external Agent hosts. */

import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { WorkspaceConfigManager } from '@linkterm/runtime/core/workspace/index';
import { JLinkAdapter } from '@linkterm/runtime/jlink/jlink-adapter';
import { createMcpServer } from '@linkterm/mcp';
import { buildSession } from '@linkterm/runtime/core/session/factory';
import { createDesktopNativeBindings } from './native-bindings.js';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import { OperationAdmissionCoordinator } from '@linkterm/runtime/core/operation-admission/operation-admission-coordinator';

const nativeBindings = createDesktopNativeBindings();
const serialDiscovery = new SerialDiscovery({ listFn: nativeBindings.listSerialPorts });
const sessionManager = new SessionManager({
  sessionFactory: (id, config) => buildSession(id, config, nativeBindings),
});
const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
  runtimeId: `stdio-${process.pid}`,
});
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
  operationAdmissionCoordinator,
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
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
