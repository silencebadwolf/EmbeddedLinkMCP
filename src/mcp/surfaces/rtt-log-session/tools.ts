import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openRttLogSession } from '../../../core/session/rtt-log-session-open.js';
import {
  prepareProfileRttLogTarget,
  ProfileRttLogTargetError,
} from '../../../core/session/rtt-log-profile-target.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { IJLinkBackend } from '../../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../../jlink/device-catalog.js';
import {
  ControlProfileNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  type ControlProfileManager,
  type HostPathResolver,
} from '../../../core/workspace/index.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
  type ToolHandlerSuccess,
} from '../../registry.js';
import { translateJLinkError } from '../debug/error-translate.js';
import { openRttLogSessionInputSchema, type OpenRttLogSessionInput } from './schemas.js';

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
