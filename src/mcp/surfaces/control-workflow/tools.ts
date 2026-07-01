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
  type HostPathResolver,
} from '../../../core/workspace/index.js';
import type { IJLinkBackend } from '../../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../../jlink/device-catalog.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { registerTool, ToolError, type ToolHandlerResult } from '../../registry.js';
import { ConfirmationRequiredError, translateJLinkError } from '../debug/error-translate.js';
import { defaultOpenSerial, type ControlProfileOpenSerial } from '../control-profile/tools.js';
import { runControlWorkflow } from './workflow-runner.js';
import {
  controlWorkflowJobCancelInputSchema,
  controlWorkflowJobCleanupInputSchema,
  controlWorkflowJobReadInputSchema,
  controlWorkflowJobStatusInputSchema,
  runControlWorkflowInputSchema,
  type ControlWorkflowJobCancelInput,
  type ControlWorkflowJobCleanupInput,
  type ControlWorkflowJobReadInput,
  type ControlWorkflowJobStatusInput,
  type RunControlWorkflowInput,
} from './schemas.js';
import {
  ControlWorkflowJobManager,
  type ControlWorkflowJobSnapshot,
} from './job-manager.js';

/** registerControlWorkflowTools 的依赖容器。 */
export interface ControlWorkflowToolsDeps {
  controlProfileManager: ControlProfileManager;
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  hostPathResolver?: HostPathResolver;
  controlProfileOpenSerial?: ControlProfileOpenSerial;
  controlWorkflowJobManager?: ControlWorkflowJobManager;
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
  const jobManager = deps.controlWorkflowJobManager ?? new ControlWorkflowJobManager();

  registerTool(server, {
    name: 'run_control_workflow',
    description:
      'Run a deterministic high-level hardware control workflow from the current workspace control profile at <root>/.linkterm/control-profile.json. ' +
      'Prefer this high-level tool over manually chaining low-level J-Link/serial tools for supported modes. ' +
      'Modes: flash-observe, debug-diagnose, flash-observe-diagnose. Prefer profile flash.binary and omit firmware.filePath unless intentionally overriding it; request firmware overrides are sandboxed under root. ' +
      'Firmware is read server-side, so AI clients must not chunk base64 manually. High-impact modes require confirm=true. ' +
      'For long operations, request execution.mode=background, then poll get_control_workflow_job_status and read_control_workflow_job; cancel with cancel_control_workflow_job if needed. ' +
      'Known SEGGER/J-Link failures are returned with workflow failureCode and machine-readable nextActions. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: runControlWorkflowInputSchema,
    handler: async (input: RunControlWorkflowInput): Promise<ToolHandlerResult> => {
      try {
        const runnerDeps = {
          controlProfileManager: deps.controlProfileManager,
          sessionManager: deps.sessionManager,
          jlinkBackend: deps.jlinkBackend,
          jlinkDeviceCatalog: deps.jlinkDeviceCatalog,
          hostPathResolver: deps.hostPathResolver,
          openSerial,
        };
        if (input.execution?.mode === 'background' && input.dryRun !== true) {
          if (requiresHighImpactWorkflow(input) && input.confirm !== true) {
            throw new ConfirmationRequiredError('run_control_workflow');
          }
          const job = jobManager.create({ input, correlationId: input.correlationId });
          void jobManager.start(job.jobId, ({ signal, update }) =>
            runControlWorkflow(runnerDeps, input, { signal, onUpdate: update }),
          );
          return {
            success: true,
            evidence: {
              kind: 'debug_output',
              data: toJobStartedData(jobManager.getStatus(job.jobId)),
              cursor: 0,
            },
          };
        }

        const data = await runControlWorkflow(runnerDeps, input);
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

  registerTool(server, {
    name: 'get_control_workflow_job_status',
    description:
      'Read lightweight status for a LinkTerm control workflow background job. Use this to poll long flash/observe/debug workflows instead of retrying hardware operations. This tool is read-only.',
    sensitivity: 'read-only',
    inputSchema: controlWorkflowJobStatusInputSchema,
    handler: (input: ControlWorkflowJobStatusInput): ToolHandlerResult => ({
      success: true,
      evidence: {
        kind: 'debug_output',
        data: toJobStatusData(jobManager.getStatus(input.jobId)),
        cursor: 0,
      },
    }),
  });

  registerTool(server, {
    name: 'read_control_workflow_job',
    description:
      'Read partial or final structured evidence for a LinkTerm control workflow background job, including workflow steps and transcript cursor references. This tool is read-only.',
    sensitivity: 'read-only',
    inputSchema: controlWorkflowJobReadInputSchema,
    handler: (input: ControlWorkflowJobReadInput): ToolHandlerResult => ({
      success: true,
      evidence: {
        kind: 'debug_output',
        data: toJobReadData(jobManager.read(input.jobId)),
        cursor: 0,
      },
    }),
  });

  registerTool(server, {
    name: 'cancel_control_workflow_job',
    description:
      'Cancel an active LinkTerm control workflow background job using LinkTerm-owned AbortSignal paths. No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: controlWorkflowJobCancelInputSchema,
    handler: (input: ControlWorkflowJobCancelInput): ToolHandlerResult => ({
      success: true,
      evidence: {
        kind: 'debug_output',
        data: toJobStatusData(jobManager.cancel(input.jobId)),
        cursor: 0,
      },
    }),
  });

  registerTool(server, {
    name: 'cleanup_control_workflow_jobs',
    description:
      'Clean up completed or expired LinkTerm control workflow background jobs. Active jobs are not removed; cancel first if needed.',
    sensitivity: 'state-affecting',
    inputSchema: controlWorkflowJobCleanupInputSchema,
    handler: (input: ControlWorkflowJobCleanupInput): ToolHandlerResult => ({
      success: true,
      evidence: {
        kind: 'debug_output',
        data: jobManager.cleanup({ jobId: input.jobId, expiredOnly: input.expiredOnly }),
        cursor: 0,
      },
    }),
  });
}

const JOB_TOOLS = {
  status: 'get_control_workflow_job_status',
  read: 'read_control_workflow_job',
  cancel: 'cancel_control_workflow_job',
  cleanup: 'cleanup_control_workflow_jobs',
} as const;

function toJobStartedData(job: ControlWorkflowJobSnapshot): Record<string, unknown> {
  return { ...toJobStatusData(job), tools: JOB_TOOLS };
}

function toJobStatusData(job: ControlWorkflowJobSnapshot): Record<string, unknown> {
  return {
    jobId: job.jobId,
    state: job.state,
    mode: job.mode,
    root: job.root,
    createdAt: job.createdAt,
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    ...(job.expiresAt !== undefined ? { expiresAt: job.expiresAt } : {}),
    updatedAt: job.updatedAt,
    ...(job.currentStepId !== undefined ? { currentStepId: job.currentStepId } : {}),
    cancelRequested: job.cancelRequested,
    ...(job.workflow?.summary !== undefined ? { summary: job.workflow.summary } : {}),
    ...(job.workflow?.failedStep !== undefined ? { failedStep: job.workflow.failedStep } : {}),
    ...(job.workflow?.failureCode !== undefined ? { failureCode: job.workflow.failureCode } : {}),
  };
}

function toJobReadData(job: ControlWorkflowJobSnapshot): Record<string, unknown> {
  return {
    ...toJobStatusData(job),
    workflow: job.workflow,
  };
}

function requiresHighImpactWorkflow(input: RunControlWorkflowInput): boolean {
  return (
    input.mode === 'debug-diagnose' ||
    input.mode === 'flash-observe' ||
    input.mode === 'flash-observe-diagnose' ||
    input.debug?.haltOnFailure === true
  );
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
