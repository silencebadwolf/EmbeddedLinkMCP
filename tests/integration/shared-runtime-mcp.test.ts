import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createRuntime, ToolError as RuntimeToolError } from '@linkterm/runtime';
import { NullJLinkBackend } from '@linkterm/runtime/jlink/null-backend';
import { createAndOpenSession } from '@linkterm/runtime/services/session-open';
import { createMcpServer, ToolError } from '@linkterm/mcp';
import { createMockPtyFactory } from '../fixtures/mock-pty.js';
import { createInMemoryMcpTransportPair } from '../fixtures/mock-mcp-transport.js';

describe('compiled runtime / MCP package integration', () => {
  it('shares sessions, native factories, write queues, jobs and operation capture across UI and MCP clients', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'linkterm-shared-runtime-'));
    const pty = createMockPtyFactory();
    const runtime = await createRuntime({
      dataDir,
      nativeBindings: {
        createPty: pty.factory,
        createSerialPort: () => {
          throw new Error('No hardware in this fixture');
        },
        listSerialPorts: async () => [],
      },
      secretCodec: {
        isAvailable: () => false,
        encryptUtf8: () => {
          throw new Error('disabled');
        },
        decryptUtf8: () => {
          throw new Error('disabled');
        },
      },
      jlinkBackend: new NullJLinkBackend(),
    });
    const connections = [0, 1].map((index) => {
      const pair = createInMemoryMcpTransportPair();
      return {
        mcp: createMcpServer({ ...runtime, transportFactory: () => pair.server }),
        client: new Client({ name: `shared-runtime-${index}`, version: '1' }),
        transport: pair.client,
      };
    });
    try {
      for (const connection of connections) {
        await connection.mcp.start();
        await connection.client.connect(connection.transport);
      }
      expect(ToolError).toBe(RuntimeToolError);
      const [first, second] = connections.map((connection) => connection.client);
      expect((await first.listTools()).tools).toHaveLength(63);
      const opened = (
        await first.callTool({
          name: 'open_session',
          arguments: { config: { type: 'local-shell' } },
        })
      ).structuredContent as { success: boolean; evidence: { data: { sessionId: string } } };
      expect(opened.success).toBe(true);
      const sessionId = opened.evidence.data.sessionId;
      expect(runtime.sessionManager.summaryOf(sessionId)?.state).toBe('open');
      expect(pty.created).toHaveLength(1);
      await runtime.sessionManager.write(sessionId, new TextEncoder().encode('human\n'), {
        origin: 'human',
      });
      const written = (
        await second.callTool({
          name: 'write_to_session',
          arguments: { sessionId, payload: { encoding: 'utf-8', data: 'agent\n' } },
        })
      ).structuredContent as { success: boolean };
      expect(written.success).toBe(true);
      expect(pty.created[0].writes).toEqual(['human\n', 'agent\n']);
      const origins = runtime.sessionManager
        .read(sessionId, 0)
        .events.filter((event) => event.type === 'data')
        .map((event) => event.origin);
      expect(origins).toContain('human');
      expect(origins).toContain('ai');
      const humanSession = await createAndOpenSession(runtime.sessionManager, {
        type: 'local-shell',
      });
      const listed = (await first.callTool({ name: 'list_sessions', arguments: {} }))
        .structuredContent as { evidence: { data: { sessions: { sessionId: string }[] } } };
      expect(listed.evidence.data.sessions.map((session) => session.sessionId)).toEqual(
        expect.arrayContaining([sessionId, humanSession.sessionId]),
      );
      const job = runtime.controlWorkflowJobManager.create({
        input: { root: dataDir, mode: 'flash-observe' },
        activityOrigin: 'human',
      });
      for (const client of [first, second]) {
        const status = (
          await client.callTool({
            name: 'get_control_workflow_job_status',
            arguments: { jobId: job.jobId },
          })
        ).structuredContent as {
          success: boolean;
          evidence: { data: { jobId: string; state: string } };
        };
        expect(status.success).toBe(true);
        expect(status.evidence.data).toMatchObject({ jobId: job.jobId, state: 'queued' });
      }
      expect(runtime.operationLedger.snapshot().events.length).toBeGreaterThan(0);
    } finally {
      for (const connection of connections) {
        await connection.client.close().catch(() => undefined);
        await connection.mcp.stop();
      }
      await runtime.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
    expect(pty.created.every((instance) => instance.killCalls === 1)).toBe(true);
  });
});
