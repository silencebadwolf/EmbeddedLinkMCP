/** MCP control-workflow surface: deterministic high-level serial/flash/debug workflow. */

import { ZodError } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import {
  ControlProfileManager,
  ControlProfileNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
} from '../../../core/workspace/index.js';
import type { IJLinkBackend } from '../../../jlink/types.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { registerTool, ToolError, type ToolHandlerResult } from '../../registry.js';
import { ConfirmationRequiredError, translateJLinkError } from '../debug/error-translate.js';
import { defaultOpenSerial, type ControlProfileOpenSerial } from '../control-profile/tools.js';
import { runControlWorkflow } from './workflow-runner.js';
import { runControlWorkflowInputSchema, type RunControlWorkflowInput } from './schemas.js';

/** registerControlWorkflowTools 的依赖容器。 */
export interface ControlWorkflowToolsDeps {
  controlProfileManager: ControlProfileManager;
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  controlProfileOpenSerial?: ControlProfileOpenSerial;
}

/**
 * 注册 run_control_workflow 工具。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖；session/J-Link/profile manager 均与主进程同实例
 */
export function registerControlWorkflowTools(
  server: McpServer,
  deps: ControlWorkflowToolsDeps,
): void {
  const openSerial = deps.controlProfileOpenSerial ?? defaultOpenSerial(deps.sessionManager);

  registerTool(server, {
    name: 'run_control_workflow',
    description:
      'Run a deterministic high-level hardware control workflow from <root>/.linkterm/control-profile.json. ' +
      'Prefer this high-level tool over manually chaining low-level J-Link/serial tools for supported modes. ' +
      'Modes: flash-observe, debug-diagnose, flash-observe-diagnose. Firmware is read server-side from a path under root, ' +
      'so AI clients must not chunk base64 manually. High-impact modes require confirm=true. ' +
      'Known SEGGER/J-Link failures are returned with workflow failureCode and machine-readable nextActions.',
    sensitivity: 'state-affecting',
    inputSchema: runControlWorkflowInputSchema,
    handler: async (input: RunControlWorkflowInput): Promise<ToolHandlerResult> => {
      try {
        const data = await runControlWorkflow(
          {
            controlProfileManager: deps.controlProfileManager,
            sessionManager: deps.sessionManager,
            jlinkBackend: deps.jlinkBackend,
            openSerial,
          },
          input,
        );
        return {
          success: true,
          evidence: {
            kind: 'debug_output',
            data,
            cursor: 0,
          },
        };
      } catch (err) {
        translateControlWorkflowError(err);
      }
    },
  });
}

/**
 * 把 control-workflow 依赖域错误翻译为稳定 MCP ToolError。
 *
 * @param err 任意 throw 出的错误
 */
function translateControlWorkflowError(err: unknown): never {
  if (err instanceof ToolError) {
    throw err;
  }
  if (err instanceof ConfirmationRequiredError) {
    throw new ToolError(ERROR_CODES.CONFIRMATION_REQUIRED, 'Confirmation required for high-impact workflow', {
      tool: err.toolName,
    });
  }
  if (err instanceof ControlProfileNotFoundError) {
    throw new ToolError(ERROR_CODES.CONTROL_PROFILE_NOT_FOUND, err.message, { root: err.root });
  }
  if (err instanceof ControlProfileTooLargeError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
      root: err.root,
      size: err.size,
    });
  }
  if (err instanceof ControlProfileSchemaVersionMismatchError) {
    throw new ToolError(ERROR_CODES.CONTROL_PROFILE_SCHEMA_VERSION_MISMATCH, err.message, {
      expected: err.expected,
      actual: err.actual,
      root: err.root,
    });
  }
  if (err instanceof WorkspaceInvalidRootError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, { root: err.root });
  }
  if (err instanceof ZodError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid control workflow payload', {
      issues: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  if (err instanceof SyntaxError) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Control profile file is not valid JSON: ${err.message}`,
    );
  }
  try {
    translateJLinkError(err);
  } catch (translated) {
    if (translated instanceof ToolError) throw translated;
    throw err;
  }
}
