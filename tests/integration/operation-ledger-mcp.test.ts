import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ActivityHealthMonitor } from '@linkterm/runtime/core/activity/activity-health';
import { OperationLedger } from '@linkterm/runtime/core/activity/operation-ledger';
import { OperationRecorder } from '@linkterm/runtime/core/activity/operation-recorder';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { createMcpServer, type LinkTermMcpServer } from '@linkterm/mcp/index';
import {
  startMcpHttpRuntimeServer,
  type McpHttpRuntimeServer,
} from '@linkterm/mcp/http-runtime-server';
import type { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';

function makeSerialDiscovery(): SerialDiscovery {
  return {
    listPorts: async () => [],
  } as unknown as SerialDiscovery;
}

describe('operation ledger MCP runtime sharing', () => {
  let root: string;
  let directMcp: LinkTermMcpServer | null = null;
  let directClient: Client | null = null;
  let httpServer: McpHttpRuntimeServer | null = null;
  let httpClient: Client | null = null;
  let httpTransport: StreamableHTTPClientTransport | null = null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-operation-ledger-mcp-'));
  });

  afterEach(async () => {
    await directClient?.close().catch(() => undefined);
    await directMcp?.stop().catch(() => undefined);
    await httpClient?.close().catch(() => undefined);
    await httpTransport?.close().catch(() => undefined);
    await httpServer?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    directMcp = null;
    directClient = null;
    httpServer = null;
    httpClient = null;
    httpTransport = null;
  });

  it('records direct and HTTP MCP calls into one Main-owned runtime ledger', async () => {
    const health = new ActivityHealthMonitor();
    const ledger = new OperationLedger({ health });
    const recorder = new OperationRecorder({ ledger, health });
    const operationRecorderProvider = (input: Parameters<OperationRecorder['beginMcpCall']>[0]) =>
      recorder.beginMcpCall(input);
    const sessionManager = new SessionManager();
    const serialDiscovery = makeSerialDiscovery();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    directMcp = createMcpServer({
      sessionManager,
      serialDiscovery,
      operationRecorderProvider,
      transportFactory: () => serverTransport,
    });
    directClient = new Client({ name: 'direct-test-client', version: '1.0.0' });
    await directMcp.start();
    await directClient.connect(clientTransport);

    httpServer = await startMcpHttpRuntimeServer({
      sessionManager,
      serialDiscovery,
      operationRecorderProvider,
      metadataPath: path.join(root, 'mcp-runtime.json'),
      host: '127.0.0.1',
      port: 0,
      token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
    });
    httpClient = new Client({ name: 'http-test-client', version: '1.0.0' });
    httpTransport = new StreamableHTTPClientTransport(new URL(httpServer.url), {
      requestInit: {
        headers: { authorization: `Bearer ${httpServer.token}` },
      },
    });
    await httpClient.connect(httpTransport);

    await directClient.callTool({
      name: 'get_app_status',
      arguments: { correlationId: 'same-client-correlation' },
    });
    await httpClient.callTool({
      name: 'get_app_status',
      arguments: { correlationId: 'same-client-correlation' },
    });
    await httpClient.callTool({
      name: 'get_app_status',
      arguments: { correlationId: 'same-client-correlation' },
    });

    const snapshot = ledger.snapshot();
    const activityEvents = snapshot.events.filter((event) => event.action === 'get_app_status');
    const requestedOperations = activityEvents.filter(
      (event) => event.kind === 'operation-transition' && event.operationPhase === 'requested',
    );
    const receivedCalls = activityEvents.filter(
      (event) => event.kind === 'call-transition' && event.callPhase === 'received',
    );

    expect(new Set(snapshot.events.map((event) => event.runtimeId))).toEqual(
      new Set([snapshot.cursor.runtimeId]),
    );
    expect(snapshot.cursor.sequence).toBe(snapshot.events.at(-1)?.sequence);
    expect(requestedOperations).toHaveLength(3);
    expect(receivedCalls).toHaveLength(3);
    expect(new Set(requestedOperations.map((event) => event.operationId))).toHaveLength(3);
    expect(new Set(receivedCalls.map((event) => event.callId))).toHaveLength(3);
    expect(snapshot.events.map((event) => event.sequence)).toEqual(
      snapshot.events.map((event) => event.sequence).toSorted((a, b) => a - b),
    );
    expect(snapshot.health).toMatchObject({
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 0,
      incompleteLifecycleCount: 0,
    });
  });
});
