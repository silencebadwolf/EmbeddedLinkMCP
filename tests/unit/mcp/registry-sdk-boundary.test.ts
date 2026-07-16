import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ActivityHealthMonitor } from '@/core/activity/activity-health.js';
import { OperationLedger } from '@/core/activity/operation-ledger.js';
import { OperationRecorder } from '@/core/activity/operation-recorder.js';
import { registerTool, setOperationRecorderProvider } from '@/mcp/registry.js';

describe('MCP SDK pre-handler validation boundary', () => {
  it('rejects invalid input before the LinkTerm handler or fake backend runs', async () => {
    const server = new McpServer({ name: 'registry-boundary-server', version: '1.0.0' });
    const client = new Client({ name: 'registry-boundary-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handlerCalls = vi.fn();
    const backendCalls = vi.fn();
    const health = new ActivityHealthMonitor(() => new Date(Date.UTC(2026, 6, 13)).toISOString());
    const ledger = new OperationLedger({
      health,
      createRuntimeId: () => 'runtime_1',
      createEventId: () => 'event_1',
      now: () => new Date(Date.UTC(2026, 6, 13)).toISOString(),
    });
    const recorder = new OperationRecorder({ ledger, health });
    setOperationRecorderProvider(server, (input) => recorder.beginMcpCall(input));

    registerTool(server, {
      name: 'sdk_validated_tool',
      description: 'SDK validation characterization',
      sensitivity: 'state-affecting',
      inputSchema: z
        .object({
          payload: z.string(),
          correlationId: z.string().optional(),
          clientSchemaVersion: z.string().optional(),
        })
        .strict(),
      handler: () => {
        handlerCalls();
        backendCalls();
        return {
          success: true,
          evidence: { kind: 'app_status', data: { started: true }, cursor: 0 },
        };
      },
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'sdk_validated_tool',
        arguments: { payload: 42 },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringMatching(/Input validation error|Invalid arguments/u),
        }),
      ]);
      expect(ledger.snapshot().events).toEqual([]);
      expect(handlerCalls).not.toHaveBeenCalled();
      expect(backendCalls).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
