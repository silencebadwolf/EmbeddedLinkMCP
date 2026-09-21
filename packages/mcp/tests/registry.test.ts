import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getRegisteredToolNames,
  registerTool,
  setOperationAdmissionCoordinator,
  setOperationRecorderProvider,
  ToolError,
  type LinkTermToolResult,
} from '@linkterm/mcp/registry';
import { OperationAdmissionCoordinator } from '@linkterm/runtime/core/operation-admission/operation-admission-coordinator';
import { ActivityHealthMonitor } from '@linkterm/runtime/core/activity/activity-health';
import { OperationLedger } from '@linkterm/runtime/core/activity/operation-ledger';
import { OperationRecorder } from '@linkterm/runtime/core/activity/operation-recorder';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@linkterm/mcp/versioning/version-check';

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

function attachRecorder(server: McpServer): {
  ledger: OperationLedger;
  health: ActivityHealthMonitor;
} {
  let runtimeId = 0;
  let eventId = 0;
  let timestamp = 0;
  const now = () => new Date(Date.UTC(2026, 6, 13, 1, 0, timestamp++)).toISOString();
  const health = new ActivityHealthMonitor(now);
  const ledger = new OperationLedger({
    health,
    createRuntimeId: () => `runtime_${++runtimeId}`,
    createEventId: () => `event_${++eventId}`,
    now,
  });
  const recorder = new OperationRecorder({ ledger, health });
  setOperationRecorderProvider(server, (input) => recorder.beginMcpCall(input));
  return { ledger, health };
}

function activityPhases(ledger: OperationLedger): readonly string[] {
  return ledger.snapshot().events.map((event) => {
    if (event.kind === 'operation-transition') return `operation:${event.operationPhase}`;
    if (event.kind === 'call-transition') return `call:${event.callPhase}`;
    return `milestone:${event.progress.messageCode}`;
  });
}

function createAdmissionCoordinator(): OperationAdmissionCoordinator {
  return new OperationAdmissionCoordinator({
    runtimeId: 'runtime_registry_test',
    now: () => '2026-07-15T00:00:01.000Z',
  });
}

function lastActivityEvent(
  ledger: OperationLedger,
): ReturnType<OperationLedger['snapshot']>['events'][number] {
  const event = ledger.snapshot().events.at(-1);
  if (event === undefined) throw new Error('Expected at least one activity event');
  return event;
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
      handler: () => ({
        success: true,
        evidence: { kind: 'app_status', data: { ok: true }, cursor: 0 },
      }),
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
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: {}, cursor: 0 },
    }));

    registerTool(server, {
      name: 'sample_tool',
      description: 'sample description',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({ clientSchemaVersion: 'linkterm-mcp/0.0.0' }));

    expect(out.success).toBe(true);
    expect(out.evidence?.meta?.warning).toMatch(/schema version mismatch/i);
    expect(handler).toHaveBeenCalledOnce();
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

  it('refuses state-affecting calls when runtime code is stale before invoking the handler', async () => {
    const { server, tools } = fakeServer();
    let handlerCalls = 0;

    registerTool(server, {
      name: 'state_tool',
      description: 'state description',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      runtimeDiagnostics: () => ({
        identity: { runtimeId: 'old-runtime', pid: 1234, startedAt: '2026-06-29T12:49:36.000Z' },
        transport: { mode: 'http-owner' },
        metadata: { available: true, fresh: true },
        code: {
          fresh: false,
          staleArtifacts: [
            {
              path: 'dist/main/jlink/segger-command-runner.js',
              modifiedAt: '2026-06-30T00:00:20.000Z',
            },
          ],
        },
      }),
      handler: () => {
        handlerCalls += 1;
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    const result = await tools[0]!.callback({});
    const out = structured(result);

    expect(handlerCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(out).toMatchObject({
      success: false,
      origin: 'ai',
      schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      error: {
        code: 'INVALID_STATE',
        details: {
          staleArtifacts: [
            {
              path: 'dist/main/jlink/segger-command-runner.js',
              modifiedAt: '2026-06-30T00:00:20.000Z',
            },
          ],
        },
      },
    });
    expect(out.error?.message).toMatch(/Restart the LinkTerm MCP runtime/i);
  });

  it('preserves a runtime diagnostics provider throw before handler admission', async () => {
    const { server, tools } = fakeServer();
    const failure = new Error('runtime diagnostics unavailable');
    const handler = vi.fn();

    registerTool(server, {
      name: 'runtime_throw',
      description: 'runtime throw characterization',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      runtimeDiagnostics: () => {
        throw failure;
      },
      handler: () => {
        handler();
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    await expect(tools[0]!.callback({})).rejects.toBe(failure);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows read-only calls when runtime code is stale so clients can inspect status', async () => {
    const { server, tools } = fakeServer();

    registerTool(server, {
      name: 'read_tool',
      description: 'read description',
      sensitivity: 'read-only',
      inputSchema: schema,
      runtimeDiagnostics: () => ({
        identity: { runtimeId: 'old-runtime', pid: 1234, startedAt: '2026-06-29T12:49:36.000Z' },
        transport: { mode: 'http-owner' },
        metadata: { available: true, fresh: true },
        code: {
          fresh: false,
          staleArtifacts: [
            {
              path: 'dist/main/jlink/segger-command-runner.js',
              modifiedAt: '2026-06-30T00:00:20.000Z',
            },
          ],
        },
      }),
      handler: () => ({
        success: true,
        evidence: { kind: 'app_status', data: { ok: true }, cursor: 0 },
      }),
    });

    const result = await tools[0]!.callback({});
    const out = structured(result);

    expect(result.isError).toBe(false);
    expect(out).toMatchObject({
      success: true,
      evidence: { kind: 'app_status', data: { ok: true }, cursor: 0 },
    });
  });

  it('allows explicitly marked state-affecting calls when runtime code is stale', async () => {
    const { server, tools } = fakeServer();
    let handlerCalls = 0;

    registerTool(server, {
      name: 'runtime_control_tool',
      description: 'runtime control description',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      allowWhenRuntimeStale: true,
      runtimeDiagnostics: () => ({
        identity: { runtimeId: 'old-runtime', pid: 1234, startedAt: '2026-06-29T12:49:36.000Z' },
        transport: { mode: 'http-owner' },
        metadata: { available: true, fresh: true },
        code: {
          fresh: false,
          staleArtifacts: [
            {
              path: 'dist/main/jlink/segger-command-runner.js',
              modifiedAt: '2026-06-30T00:00:20.000Z',
            },
          ],
        },
      }),
      handler: () => {
        handlerCalls += 1;
        return {
          success: true,
          evidence: { kind: 'app_status', data: { scheduled: true }, cursor: 0 },
        };
      },
    });

    const result = await tools[0]!.callback({});
    const out = structured(result);

    expect(handlerCalls).toBe(1);
    expect(result.isError).toBe(false);
    expect(out).toMatchObject({
      success: true,
      evidence: { kind: 'app_status', data: { scheduled: true }, cursor: 0 },
    });
  });

  it('allows state-affecting AI operations through the shared admission coordinator', async () => {
    const { server, tools } = fakeServer();
    const coordinator = createAdmissionCoordinator();
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: { changed: true }, cursor: 0 },
    }));
    setOperationAdmissionCoordinator(server, coordinator);

    registerTool(server, {
      name: 'cpu_reset',
      description: 'pause admission gate',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({}));

    expect(out).toMatchObject({
      success: true,
      evidence: { data: { changed: true } },
      origin: 'ai',
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('executes high-impact AI tools immediately without human approval', async () => {
    const { server, tools } = fakeServer();
    const coordinator = createAdmissionCoordinator();
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: { flashed: true }, cursor: 0 },
    }));
    setOperationAdmissionCoordinator(server, coordinator);

    registerTool(server, {
      name: 'flash_download',
      description: 'observe-only authorization',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({}));

    expect(out).toMatchObject({
      success: true,
      evidence: { data: { flashed: true } },
      origin: 'ai',
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('allows read-only tools while AI changes are paused', async () => {
    const { server, tools } = fakeServer();
    const coordinator = createAdmissionCoordinator();
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: { paused: true }, cursor: 0 },
    }));
    setOperationAdmissionCoordinator(server, coordinator);

    registerTool(server, {
      name: 'get_status_while_paused',
      description: 'read while paused',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({}));

    expect(out).toMatchObject({
      success: true,
      evidence: { data: { paused: true } },
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('consumes approval inside admission before invoking the effectful handler', async () => {
    const { server, tools } = fakeServer();
    const coordinator = createAdmissionCoordinator();
    const order: string[] = [];
    const handler = vi.fn(() => {
      order.push('handler');
      return {
        success: true as const,
        evidence: { kind: 'app_status' as const, data: { changed: true }, cursor: 0 },
      };
    });
    setOperationAdmissionCoordinator(server, coordinator);

    registerTool(server, {
      name: 'cpu_reset',
      description: 'approval admission order',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({}));

    expect(out).toMatchObject({ success: true, evidence: { data: { changed: true } } });
    expect(order).toEqual(['handler']);
    expect(coordinator.getActiveLeaseCount()).toBe(0);
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

  it('invokes a successful handler exactly once and preserves its evidence', async () => {
    const { server, tools } = fakeServer();
    const handler = vi.fn(() => ({
      success: true as const,
      sessionId: 'sess_characterized',
      state: 'open',
      evidence: { kind: 'app_status' as const, data: { ok: true }, cursor: 7 },
    }));

    registerTool(server, {
      name: 'success_once',
      description: 'success characterization',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({ correlationId: 'corr-success' }));

    expect(handler).toHaveBeenCalledOnce();
    expect(out).toMatchObject({
      success: true,
      sessionId: 'sess_characterized',
      state: 'open',
      correlationId: 'corr-success',
      origin: 'ai',
      schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      evidence: { kind: 'app_status', data: { ok: true }, cursor: 7 },
    });
  });

  it('preserves a handler-declared failure and invokes the handler exactly once', async () => {
    const { server, tools } = fakeServer();
    const handler = vi.fn(() => ({
      success: false as const,
      sessionId: 'sess_failed',
      state: 'errored',
      error: {
        code: 'INVALID_STATE' as const,
        message: 'characterized failure',
        details: { reason: 'fixture' },
      },
    }));

    registerTool(server, {
      name: 'declared_failure',
      description: 'failure characterization',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const result = await tools[0]!.callback({ correlationId: 'corr-failure' });
    const out = structured(result);

    expect(handler).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(out).toMatchObject({
      success: false,
      sessionId: 'sess_failed',
      state: 'errored',
      correlationId: 'corr-failure',
      origin: 'ai',
      schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      error: {
        code: 'INVALID_STATE',
        message: 'characterized failure',
        details: { reason: 'fixture' },
      },
    });
  });

  it('records successful entered registry calls without changing handler results', async () => {
    const { server, tools } = fakeServer();
    const { ledger, health } = attachRecorder(server);
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: { ok: true }, cursor: 0 },
    }));

    registerTool(server, {
      name: 'get_app_status',
      description: 'recorded success',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({ correlationId: 'corr-recorded' }));

    expect(handler).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ success: true, correlationId: 'corr-recorded' });
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:succeeded',
      'call:succeeded',
    ]);
    expect(health.snapshot().incompleteLifecycleCount).toBe(0);
  });

  it('records version rejection before the handler and keeps the rejection terminal', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);
    const handler = vi.fn();

    registerTool(server, {
      name: 'cpu_reset',
      description: 'recorded version rejection',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler: () => {
        handler();
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    const result = await tools[0]!.callback({ clientSchemaVersion: 'linkterm-mcp/0.0.0' });

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:rejected',
      'call:rejected',
    ]);
    expect(lastActivityEvent(ledger)).toMatchObject({
      error: { code: 'VERSION_MISMATCH', stage: 'schema' },
    });
  });

  it('records an effectful handler failure without an approval state', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);

    registerTool(server, {
      name: 'cpu_reset',
      description: 'recorded acknowledgement rejection',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler: () => {
        throw new ToolError('INVALID_STATE', 'operation failed');
      },
    });

    const result = await tools[0]!.callback({});

    expect(result.isError).toBe(true);
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:failed',
      'call:failed',
    ]);
    expect(lastActivityEvent(ledger)).toMatchObject({
      error: { code: 'INVALID_STATE' },
    });
    expect(ledger.snapshot().events[0]).toMatchObject({
      approvalPolicy: 'none',
      authorizationSource: 'none',
    });
  });

  it('keeps ordinary handler failures terminal after a started call', async () => {
    const { server, tools } = fakeServer();
    const { ledger, health } = attachRecorder(server);

    registerTool(server, {
      name: 'cpu_reset',
      description: 'inverse policy drift after start',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler: () => {
        throw new ToolError('INVALID_STATE', 'operation failed');
      },
    });

    const result = await tools[0]!.callback({});
    const out = structured(result);

    expect(result.isError).toBe(true);
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_STATE' } });
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:failed',
      'call:failed',
    ]);
    expect(lastActivityEvent(ledger)).toMatchObject({
      error: { code: 'INVALID_STATE' },
    });
    expect(health.snapshot()).toMatchObject({
      policyFailureCount: 0,
      captureFailureCount: 0,
      droppedEventCount: 0,
      incompleteLifecycleCount: 0,
    });
  });

  it('starts state-affecting calls immediately without acknowledgement drift', async () => {
    const { server, tools } = fakeServer();
    const { ledger, health } = attachRecorder(server);

    registerTool(server, {
      name: 'cpu_reset',
      description: 'deferred policy drift',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      handler: () => ({
        success: true,
        evidence: { kind: 'app_status', data: { reset: true }, cursor: 0 },
      }),
    });

    const out = structured(await tools[0]!.callback({}));

    expect(out).toMatchObject({ success: true, evidence: { data: { reset: true } } });
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:succeeded',
      'call:succeeded',
    ]);
    expect(health.snapshot()).toMatchObject({
      policyFailureCount: 0,
      incompleteLifecycleCount: 0,
    });
  });

  it('records stale runtime rejection before the handler and preserves the structured result', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);
    const handler = vi.fn();

    registerTool(server, {
      name: 'cpu_reset',
      description: 'recorded stale rejection',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      runtimeDiagnostics: () => ({
        identity: { runtimeId: 'old-runtime', pid: 1234, startedAt: '2026-06-29T12:49:36.000Z' },
        transport: { mode: 'http-owner' },
        metadata: { available: true, fresh: true },
        code: {
          fresh: false,
          staleArtifacts: [{ path: 'dist/main/index.js', modifiedAt: '2026-07-13T00:00:00.000Z' }],
        },
      }),
      handler: () => {
        handler();
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    const out = structured(await tools[0]!.callback({}));

    expect(handler).not.toHaveBeenCalled();
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_STATE' } });
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:rejected',
      'call:rejected',
    ]);
    expect(lastActivityEvent(ledger)).toMatchObject({
      error: { code: 'INVALID_STATE', stage: 'runtime-precondition' },
    });
  });

  it('records runtime diagnostics throw as pre-admission rejection while preserving the throw', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);
    const failure = new Error('runtime diagnostics unavailable');
    const handler = vi.fn();

    registerTool(server, {
      name: 'cpu_reset',
      description: 'recorded runtime diagnostics throw',
      sensitivity: 'state-affecting',
      inputSchema: schema,
      runtimeDiagnostics: () => {
        throw failure;
      },
      handler: () => {
        handler();
        return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
      },
    });

    await expect(tools[0]!.callback({})).rejects.toBe(failure);

    expect(handler).not.toHaveBeenCalled();
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:rejected',
      'call:rejected',
    ]);
    expect(lastActivityEvent(ledger)).toMatchObject({
      error: { code: 'RUNTIME_DIAGNOSTICS_FAILED', stage: 'runtime-precondition' },
    });
  });

  it('records successful business effect plus serialization failure as Operation succeeded and Call failed', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);

    registerTool(server, {
      name: 'get_app_status',
      description: 'serialization failure',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => ({
        success: true,
        evidence: {
          kind: 'app_status',
          data: {
            toJSON() {
              throw new Error('serialize evidence failed');
            },
          },
          cursor: 0,
        },
      }),
    });

    await expect(tools[0]!.callback({})).rejects.toThrow(/serialize evidence failed/u);
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:succeeded',
      'call:failed',
    ]);
  });

  it('records response construction failure as Operation succeeded and Call failed', async () => {
    const { server, tools } = fakeServer();
    const { ledger } = attachRecorder(server);
    const result = new Proxy(
      { success: true },
      {
        get(target, key, receiver) {
          if (key === 'evidence') {
            throw new Error('construct response failed');
          }
          return Reflect.get(target, key, receiver);
        },
      },
    ) as unknown as { success: true; evidence: never };

    registerTool(server, {
      name: 'get_app_status',
      description: 'construction failure',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler: () => result,
    });

    await expect(tools[0]!.callback({})).rejects.toThrow(/construct response failed/u);
    expect(activityPhases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:succeeded',
      'call:failed',
    ]);
  });

  it('keeps handler behavior unchanged when the recorder provider itself throws', async () => {
    const { server, tools } = fakeServer();
    const handler = vi.fn(() => ({
      success: true as const,
      evidence: { kind: 'app_status' as const, data: { ok: true }, cursor: 0 },
    }));
    setOperationRecorderProvider(server, () => {
      throw new Error('recorder unavailable');
    });

    registerTool(server, {
      name: 'get_app_status',
      description: 'provider throw no-op',
      sensitivity: 'read-only',
      inputSchema: schema,
      handler,
    });

    const out = structured(await tools[0]!.callback({}));

    expect(handler).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ success: true, evidence: { data: { ok: true } } });
  });
});
