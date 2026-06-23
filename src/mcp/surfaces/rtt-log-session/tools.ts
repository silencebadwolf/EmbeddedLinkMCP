import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openRttLogSession } from '../../../core/session/rtt-log-session-open.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { IJLinkBackend } from '../../../jlink/types.js';
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
}

/** 注册 RTT 日志会话 MCP 工具。 */
export function registerRttLogSessionTools(
  server: McpServer,
  deps: RttLogSessionToolsDeps,
): void {
  registerTool(server, {
    name: 'open_rtt_log_session',
    description:
      'Open or reuse a read-only RTT log terminal session for an already connected probe/channel. ' +
      'Requires RTT to be connected through the J-Link backend first; does not start GDB server or external tools.',
    sensitivity: 'state-affecting',
    inputSchema: openRttLogSessionInputSchema,
    handler: async (input: OpenRttLogSessionInput): Promise<ToolHandlerResult> => {
      try {
        const result = await openRttLogSession({
          sessionManager: deps.sessionManager,
          jlinkBackend: deps.jlinkBackend,
          probeId: input.probeId,
          channelIndex: input.channelIndex,
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
              probeId: input.probeId,
              channelIndex: input.channelIndex,
              reused: result.reused,
            },
            cursor: result.session.read(0).cursor,
          },
        });
      } catch (err) {
        try {
          translateJLinkError(err);
        } catch (translated) {
          if (translated instanceof ToolError) throw translated;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError(ERROR_CODES.INTERNAL, message);
      }
    },
  });
}

function ok(value: Omit<ToolHandlerSuccess, 'success'>): ToolHandlerSuccess {
  return { success: true, ...value };
}
