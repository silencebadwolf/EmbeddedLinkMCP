import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openRttLogSession } from '@linkterm/runtime/core/session/rtt-log-session-open';
import {
  prepareProfileRttLogTarget,
  ProfileRttLogTargetError,
} from '@linkterm/runtime/core/session/rtt-log-profile-target';
import type { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { diagnoseRttLogTranscript } from '@linkterm/runtime/core/session/rtt-log-diagnostics';
import type { IJLinkBackend } from '@linkterm/runtime/jlink/types';
import type { JLinkDeviceCatalog } from '@linkterm/runtime/jlink/device-catalog';
import {
  ControlProfileNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  type ControlProfileManager,
  type HostPathResolver,
} from '@linkterm/runtime/core/workspace/index';
import { ERROR_CODES } from '@linkterm/contracts/error-codes';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
  type ToolHandlerSuccess,
} from '../../registry.js';
import { translateJLinkError } from '../debug/error-translate.js';
import {
  diagnoseRttLogSessionInputSchema,
  openRttLogSessionInputSchema,
  type DiagnoseRttLogSessionInput,
  type OpenRttLogSessionInput,
} from './schemas.js';

/** RTT 日志会话 MCP 工具依赖。 */
export interface RttLogSessionToolsDeps {
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  controlProfileManager?: ControlProfileManager;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  hostPathResolver?: HostPathResolver;
}

/** 注册 RTT 日志会话 MCP 工具。 */
export function registerRttLogSessionTools(
  server: McpServer,
  deps: RttLogSessionToolsDeps,
): void {
  registerTool(server, {
    name: 'open_rtt_log_session',
    description:
      'Open or reuse a read-only App-visible RTT log terminal session. With root, LinkTerm uses the workspace control profile to connect J-Link, start the managed GDB server required for RTT, connect RTT, and open the shared session in one high-level operation. With probeId, reuses an already prepared probe/channel.',
    sensitivity: 'state-affecting',
    inputSchema: openRttLogSessionInputSchema,
    handler: async (input: OpenRttLogSessionInput): Promise<ToolHandlerResult> => {
      try {
        const target = await resolveRttLogTarget(input, deps);
        const result = await openRttLogSession({
          sessionManager: deps.sessionManager,
          jlinkBackend: deps.jlinkBackend,
          probeId: target.probeId,
          channelIndex: target.channelIndex,
          pollIntervalMs: input.pollIntervalMs,
          maxBytesPerRead: input.maxBytesPerRead,
          label: input.label,
          createdBy: 'ai',
        });
        return ok({
          sessionId: result.session.id,
          state: result.session.state,
          evidence: {
            kind: 'terminal_output',
            data: {
              sessionId: result.session.id,
              connectionType: 'rtt-log',
              probeId: target.probeId,
              channelIndex: target.channelIndex,
              reused: result.reused,
              gdbServerStarted: target.gdbServerStarted,
              ...(target.root !== undefined
                ? {
                    root: target.root,
                    hostRoot: target.hostRoot,
                    rootResolved: target.rootResolved,
                  }
                : {}),
            },
            cursor: result.session.read(0).cursor,
          },
        });
      } catch (err) {
        translateRttLogToolError(err);
      }
    },
  });

  registerTool(server, {
    name: 'diagnose_rtt_log_session',
    description:
      'Read-only diagnostic for an existing App-visible RTT log session. Classifies SEGGER transport banner bytes separately from firmware-origin RTT output so agents do not repeat flash/reset solely because logs are silent.',
    sensitivity: 'read-only',
    inputSchema: diagnoseRttLogSessionInputSchema,
    handler: (input: DiagnoseRttLogSessionInput): ToolHandlerResult => {
      const summary = deps.sessionManager.summaryOf(input.sessionId);
      if (summary === null) {
        return {
          success: false,
          sessionId: input.sessionId,
          error: {
            code: ERROR_CODES.SESSION_NOT_FOUND,
            message: `Session not found: ${input.sessionId}`,
          },
        };
      }
      if (summary.connectionType !== 'rtt-log') {
        return {
          success: false,
          sessionId: input.sessionId,
          state: summary.state,
          error: {
            code: ERROR_CODES.INVALID_ARGUMENT,
            message:
              `Session ${input.sessionId} is ${summary.connectionType}; diagnose_rtt_log_session requires an rtt-log session`,
          },
        };
      }
      const readResult = deps.sessionManager.read(input.sessionId, 0);
      const diagnosis = diagnoseRttLogTranscript({
        sessionId: input.sessionId,
        state: summary.state,
        connectionType: summary.connectionType,
        rttLog: summary.rttLog,
        readResult,
      });
      return ok({
        sessionId: input.sessionId,
        state: summary.state,
        evidence: {
          kind: 'debug_output',
          data: diagnosis,
          cursor: readResult.cursor,
        },
      });
    },
  });
}

interface ResolvedRttLogTarget {
  probeId: string;
  channelIndex: number;
  gdbServerStarted: boolean;
  root?: string;
  hostRoot?: string;
  rootResolved?: boolean;
}

async function resolveRttLogTarget(
  input: OpenRttLogSessionInput,
  deps: RttLogSessionToolsDeps,
): Promise<ResolvedRttLogTarget> {
  if (input.probeId !== undefined) {
    return {
      probeId: input.probeId,
      channelIndex: input.channelIndex,
      gdbServerStarted: false,
    };
  }
  if (input.root === undefined) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'probeId or root is required');
  }
  if (deps.controlProfileManager === undefined) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'root-based RTT open requires a control profile manager',
    );
  }
  const prepared = await prepareProfileRttLogTarget(
    { root: input.root, channelIndex: input.channelIndex },
    {
      controlProfileManager: deps.controlProfileManager,
      jlinkBackend: deps.jlinkBackend,
      jlinkDeviceCatalog: deps.jlinkDeviceCatalog,
      hostPathResolver: deps.hostPathResolver,
    },
  );
  return {
    probeId: prepared.probeId,
    channelIndex: prepared.channelIndex,
    gdbServerStarted: prepared.gdbServerStarted,
    root: prepared.root,
    hostRoot: prepared.hostRoot,
    rootResolved: prepared.rootResolved,
  };
}

function translateRttLogToolError(err: unknown): never {
  if (err instanceof ToolError) throw err;
  if (err instanceof ProfileRttLogTargetError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message);
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
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new ToolError(ERROR_CODES.INTERNAL, message);
}

function ok(value: Omit<ToolHandlerSuccess, 'success'>): ToolHandlerSuccess {
  return { success: true, ...value };
}
