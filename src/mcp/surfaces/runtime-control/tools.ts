import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { ToolError, registerTool, type ToolHandlerResult } from '../../registry.js';
import {
  restartMcpRuntimeInputSchema,
  type RestartMcpRuntimeInput,
} from './schemas.js';

export const DEFAULT_RUNTIME_RESTART_DELAY_MS = 250;
const RESTART_REASON = 'stale-runtime-recovery';

export interface RuntimeRestartRequest {
  delayMs: number;
  requestedAt: string;
  reason: typeof RESTART_REASON;
}

export interface RuntimeRestartScheduleResult {
  scheduled: boolean;
  delayMs: number;
  mode: string;
  alreadyScheduled?: boolean;
  message?: string;
}

export type RuntimeRestartScheduler = (
  request: RuntimeRestartRequest,
) => RuntimeRestartScheduleResult | Promise<RuntimeRestartScheduleResult>;

export interface RuntimeControlToolsDeps {
  runtimeRestartScheduler?: RuntimeRestartScheduler;
}

export function registerRuntimeControlTools(server: McpServer, deps: RuntimeControlToolsDeps): void {
  registerTool(server, {
    name: 'restart_mcp_runtime',
    description:
      'Runtime recovery schedules a LinkTerm MCP runtime restart after returning structured evidence. Does not touch probes, flash, reset, serial sessions, RTT, GDB, or UI control. After restart, call get_app_status before hardware operations.',
    sensitivity: 'state-affecting',
    allowWhenRuntimeStale: true,
    inputSchema: restartMcpRuntimeInputSchema,
    handler: async (input: RestartMcpRuntimeInput): Promise<ToolHandlerResult> => {
      if (deps.runtimeRestartScheduler === undefined) {
        throw new ToolError(
          ERROR_CODES.NOT_IMPLEMENTED,
          'MCP runtime restart scheduling is not available in this runtime.',
          { tool: 'restart_mcp_runtime' },
        );
      }

      const requestedAt = new Date().toISOString();
      const request: RuntimeRestartRequest = {
        delayMs: input.delayMs ?? DEFAULT_RUNTIME_RESTART_DELAY_MS,
        requestedAt,
        reason: RESTART_REASON,
      };
      const result = await deps.runtimeRestartScheduler(request);

      return {
        success: true,
        evidence: {
          kind: 'app_status',
          data: {
            restartScheduled: result.scheduled,
            delayMs: result.delayMs,
            mode: result.mode,
            requestedAt,
            alreadyScheduled: result.alreadyScheduled === true,
            ...(result.message ? { message: result.message } : {}),
            nextAction: 'Call get_app_status after the runtime restarts before hardware operations.',
          },
          cursor: 0,
        },
      };
    },
  });
}
