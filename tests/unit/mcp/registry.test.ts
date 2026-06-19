import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRegisteredToolNames,
  registerTool,
  ToolError,
  type LinkTermToolResult,
} from '@/mcp/registry.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/versioning/version-check.js';

const schema = z
  .object({
    correlationId: z.string().optional(),
    clientSchemaVersion: z.string().optional(),
  })
  .strict();

interface RegisteredTool {
  name: string;
  options: { description?: string; inputSchema?: Record<string, z.ZodType> };
  callback: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

function fakeServer(): { server: McpServer; tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      options: { description?: string; inputSchema?: Record<string, z.ZodType> },
      callback: (args: Record<string, unknown>) => Promise<CallToolResult>,
    ): void {
      tools.push({ name, options, callback });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function structured(result: CallToolResult): LinkTermToolResult {
  return result.structuredContent as unknown as LinkTermToolResult;
}

describe('MCP tool registry wrapper', () => {
  it('tracks registered names and forwards description and input schema to the SDK', () => {
    const { server, tools } = fakeServer();

    registerTool(server, {
      name: 'sample_tool',
      description: 'sample description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => ({ success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } }),
    });

    expect(getRegisteredToolNames(server)).toEqual(['sample_tool']);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.options.description).toBe('sample description');
    expect(Object.keys(tools[0]!.options.inputSchema ?? {}).sort()).toEqual([
      'clientSchemaVersion',
      'correlationId',
    ]);
  });

  it('forces origin, schemaVersion, and correlationId on successful results', async () => {
    const { server, tools } = fakeServer();

    registerTool(server, {
      name: 'sample_tool',
      description: 'sample description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => ({ success: true, evidence: { kind: 'app_status', data: { ok: true }, cursor: 0 } }),
    });

    const out = structured(await tools[0]!.callback({ correlationId: 'corr-1' }));

    expect(out).toMatchObject({
      success: true,
      correlationId: 'corr-1',
      origin: 'ai',
      schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      evidence: { kind: 'app_status', data: { ok: true }, cursor: 0 },
    });
  });

  it('adds schema mismatch warnings to read-only evidence metadata', async () => {
    const { server, tools } = fakeServer();

    registerTool(server, {
      name: 'sample_tool',
      description: 'sample description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => ({ success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } }),
    });

    const out = structured(await tools[0]!.callback({ clientSchemaVersion: 'linkterm-mcp/0.0.0' }));

    expect(out.success).toBe(true);
    expect(out.evidence?.meta?.warning).toMatch(/schema version mismatch/i);
  });

  it('refuses state-affecting schema mismatches before invoking the handler', async () => {
    const { server, tools } = fakeServer();
    let handlerCalls = 0;

    registerTool(server, {
      name: 'state_tool',
      description: 'state description',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler: () => {
        handlerCalls += 1;
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    const result = await tools[0]!.callback({ clientSchemaVersion: 'linkterm-mcp/0.0.0' });
    const out = structured(result);

    expect(handlerCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(out).toMatchObject({
      success: false,
      origin: 'ai',
      schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      error: { code: 'VERSION_MISMATCH' },
    });
  });

  it('normalizes ToolError and unexpected exceptions into structured failures', async () => {
    const { server, tools } = fakeServer();

    registerTool(server, {
      name: 'tool_error',
      description: 'tool error description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => {
        throw new ToolError('INVALID_ARGUMENT', 'bad input', { field: 'root' });
      },
    });
    registerTool(server, {
      name: 'unexpected_error',
      description: 'unexpected error description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => {
        throw new Error('boom');
      },
    });

    const toolError = structured(await tools[0]!.callback({}));
    const unexpectedError = structured(await tools[1]!.callback({}));

    expect(toolError).toMatchObject({
      success: false,
      origin: 'ai',
      error: { code: 'INVALID_ARGUMENT', message: 'bad input', details: { field: 'root' } },
    });
    expect(unexpectedError).toMatchObject({
      success: false,
      origin: 'ai',
      error: { code: 'INTERNAL', message: 'boom' },
    });
  });
});
