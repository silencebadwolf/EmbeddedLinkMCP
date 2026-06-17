/**
 * MCP 终端工具实现。
 *
 * 8 个工具均为 SessionManager 的薄包装：
 * - 不直接接触任何 transport（这是 §4.4 §5.1 的硬安全边界）
 * - 写入硬编码 origin: 'ai'
 * - 读取走 sequence cursor，truncated 标志原样回传
 * - 错误统一翻译为 ToolError 系的稳定 code，由 registry 包成结构化失败
 *
 * 注册入口：{@link registerTerminalTools}。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { ISession } from '../../../core/session/types.js';
import { SessionNotOpenError, SessionNotFoundError } from '../../../core/session/types.js';
import type { TranscriptEvent } from '../../../core/transcript/types.js';
import {
  parseMarkerSpec,
  sendAndWait,
  type CompletionMarker,
  type EchoStrategy,
  type SessionManagerLike,
} from '../../../core/terminal-rules/index.js';
import type { SerialDiscovery } from '../../../transports/serial/serial-discovery.js';
import { buildSession } from '../../../core/session/factory.js';
import type { SessionCreateRequestConfig } from '../../../shared/preload-api.js';
import { serializeTranscriptEvent } from '../../../shared/transcript-ipc-types.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
  type ToolHandlerSuccess,
} from '../../registry.js';
import {
  closeSessionInputSchema,
  decodeDataPayload,
  discoverSerialPortsInputSchema,
  getSessionStatusInputSchema,
  listSessionsInputSchema,
  openSessionInputSchema,
  readFromSessionInputSchema,
  sendAndWaitInputSchema,
  writeToSessionInputSchema,
  type CloseSessionInput,
  type DiscoverSerialPortsInput,
  type GetSessionStatusInput,
  type ListSessionsInput,
  type OpenSessionInput,
  type ReadFromSessionInput,
  type SendAndWaitInput,
  type WriteToSessionInput,
} from './schemas.js';

/** registerTerminalTools 的依赖容器；与 main 进程 MainProcessContext 同源。 */
export interface TerminalToolsDeps {
  sessionManager: SessionManager;
  serialDiscovery: SerialDiscovery;
}

/**
 * 把 8 个 MCP 终端工具注册到给定的 McpServer。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖（SessionManager 必须与 IPC 层同实例）
 */
export function registerTerminalTools(server: McpServer, deps: TerminalToolsDeps): void {
  const { sessionManager, serialDiscovery } = deps;

  registerTool(server, {
    name: 'list_sessions',
    description: 'List all active sessions with states and non-sensitive UI metadata.',
    sensitivity: 'read-only',
    inputSchema: listSessionsInputSchema,
    handler: (_input: ListSessionsInput): ToolHandlerResult => {
      const sessions = sessionManager.listSummaries();
      return successOk({
        evidence: {
          kind: 'terminal_output',
          data: { sessions },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'open_session',
    description:
      'Create a new session (serial / ssh / local-shell) and open the underlying transport. ' +
      'Returns the generated sessionId on success.',
    sensitivity: 'state-affecting',
    inputSchema: openSessionInputSchema,
    handler: async (input: OpenSessionInput): Promise<ToolHandlerResult> => {
      let session: ISession;
      try {
        // 使用 createAndOpen：open 失败时 session 不入 manager、不广播 created/destroyed —— 避免幽灵 session
        // input.config 的形态由 zod 强校验，等价于 SessionCreateRequestConfig；
        // 显式 cast 把匿名联合类型贴到 shared 命名类型，让 buildSession 跨入口签名一致。
        const config = input.config as unknown as SessionCreateRequestConfig;
        session = await sessionManager.createAndOpen((id) => buildSession(id, config), {
          connectionType: config.type,
          label: config.label,
          createdBy: 'ai',
          ...(config.type === 'serial'
            ? { serial: { port: config.port, baudRate: config.baudRate, mode: config.mode } }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError(
          ERROR_CODES.INTERNAL,
          `Failed to open session: ${redactSensitive(message, input)}`,
        );
      }
      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: { sessionId: session.id, type: input.config.type },
          cursor: latestCursor(session),
        },
      });
    },
  });

  registerTool(server, {
    name: 'close_session',
    description:
      'Close the underlying transport of a session, but keep its transcript readable. ' +
      'The sessionId remains visible in list_sessions until the process exits.',
    sensitivity: 'state-affecting',
    inputSchema: closeSessionInputSchema,
    handler: async (input: CloseSessionInput): Promise<ToolHandlerResult> => {
      const session = requireSession(sessionManager, input.sessionId);
      await session.close();
      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: { sessionId: session.id, state: session.state },
          cursor: latestCursor(session),
        },
      });
    },
  });

  registerTool(server, {
    name: 'write_to_session',
    description:
      'Write bytes to a session. Origin is hard-coded to "ai"; use correlationId to tag the write ' +
      'in the transcript audit trail.',
    sensitivity: 'state-affecting',
    inputSchema: writeToSessionInputSchema,
    handler: async (input: WriteToSessionInput): Promise<ToolHandlerResult> => {
      const session = requireSession(sessionManager, input.sessionId);
      const data = decodeOrFail(input.payload);
      try {
        await sessionManager.write(input.sessionId, data, {
          origin: 'ai',
          correlationId: input.correlationId,
        });
      } catch (err) {
        if (err instanceof SessionNotOpenError) {
          throw new ToolError(ERROR_CODES.NOT_OPEN, err.message, {
            sessionId: input.sessionId,
            state: err.sessionState,
          });
        }
        if (err instanceof SessionNotFoundError) {
          throw new ToolError(ERROR_CODES.SESSION_NOT_FOUND, err.message, {
            sessionId: input.sessionId,
          });
        }
        throw err;
      }
      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: { bytesWritten: data.byteLength },
          cursor: latestCursor(session),
        },
      });
    },
  });

  registerTool(server, {
    name: 'read_from_session',
    description:
      'Read transcript events of a session since the given cursor (default 0 = earliest visible). ' +
      'Returns events with origin/sequence/timestamp/meta and a new cursor for the next call. ' +
      'truncated=true means earlier events were dropped from the ring buffer.',
    sensitivity: 'read-only',
    inputSchema: readFromSessionInputSchema,
    handler: (input: ReadFromSessionInput): ToolHandlerResult => {
      const session = requireSession(sessionManager, input.sessionId);
      const result = sessionManager.read(input.sessionId, input.cursor);
      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: {
            events: result.events.map(serializeEvent),
            truncated: result.truncated,
            oldestAvailableSequence: result.oldestAvailableSequence,
          },
          cursor: result.cursor,
          meta: result.truncated
            ? { truncated: true, oldestAvailableSequence: result.oldestAvailableSequence }
            : undefined,
        },
      });
    },
  });

  registerTool(server, {
    name: 'send_and_wait',
    description:
      'Write bytes to a session and wait until a completion marker is observed in device output, ' +
      'or timeoutMs elapses. Phase 7: supports cross-chunk string/RegExp markers, echo stripping, ' +
      'and structured timeout/closed payloads (received bytes are returned even on failure).',
    sensitivity: 'state-affecting',
    inputSchema: sendAndWaitInputSchema,
    handler: async (input: SendAndWaitInput): Promise<ToolHandlerResult> => {
      const session = requireSession(sessionManager, input.sessionId);
      const data = decodeOrFail(input.payload);

      let parsedMarkers: CompletionMarker[] | undefined;
      if (input.completionMarkers) {
        try {
          parsedMarkers = input.completionMarkers.map((m) => parseMarkerSpec(m));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new ToolError(
            ERROR_CODES.INVALID_ARGUMENT,
            `Invalid completion marker pattern: ${message}`,
          );
        }
      }

      const deps: { sessionManager: SessionManagerLike } = {
        sessionManager,
      };
      let result;
      try {
        result = await sendAndWait(deps, {
          sessionId: input.sessionId,
          payload: data,
          // 仅当 caller 显式传 timeoutMs 时覆盖；否则交给 core 默认（TerminalRuleSet.defaultTimeoutMs = 5s）
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
          ...(input.appendLineEnding !== undefined
            ? { appendLineEnding: input.appendLineEnding }
            : {}),
          rules: {
            ...(parsedMarkers !== undefined ? { completionMarkers: parsedMarkers } : {}),
            ...(input.echoStrategy !== undefined
              ? { echoStrategy: input.echoStrategy as EchoStrategy }
              : {}),
            ...(input.lineEnding !== undefined ? { lineEnding: input.lineEnding } : {}),
          },
        });
      } catch (err) {
        if (err instanceof SessionNotOpenError) {
          throw new ToolError(ERROR_CODES.NOT_OPEN, err.message, {
            sessionId: input.sessionId,
            state: err.sessionState,
          });
        }
        if (err instanceof SessionNotFoundError) {
          throw new ToolError(ERROR_CODES.SESSION_NOT_FOUND, err.message, {
            sessionId: input.sessionId,
          });
        }
        throw err;
      }

      if (!result.success) {
        if (result.reason === 'timeout') {
          throw new ToolError(
            ERROR_CODES.TIMEOUT,
            `Timed out waiting for completion`,
            {
              sessionId: session.id,
              cursorBefore: result.cursorBefore,
              cursorAfter: result.cursorAfter,
              receivedBase64: result.receivedBase64,
              bytesWritten: result.bytesWritten,
            },
          );
        }
        if (result.reason === 'queue-full') {
          throw new ToolError(ERROR_CODES.QUEUE_FULL, 'Write queue is full; back off and retry', {
            sessionId: session.id,
          });
        }
        if (result.reason === 'session-closed') {
          throw new ToolError(
            ERROR_CODES.SESSION_CLOSED,
            `Session entered terminal state during sendAndWait: ${result.sessionState}`,
            {
              sessionId: session.id,
              sessionState: result.sessionState,
              cursorBefore: result.cursorBefore,
              cursorAfter: result.cursorAfter,
              receivedBase64: result.receivedBase64,
              bytesWritten: result.bytesWritten,
            },
          );
        }
        // aborted —— 当前 MCP 入口未暴露 signal，理论上不会触发，落到 INTERNAL
        throw new ToolError(ERROR_CODES.INTERNAL, `sendAndWait aborted unexpectedly`, {
          sessionId: session.id,
          reason: result.reason,
        });
      }

      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: {
            bytesWritten: result.bytesWritten,
            matchedMarkerIndex: result.matchedMarkerIndex,
            receivedBase64: result.receivedBase64,
            cursorBefore: result.cursorBefore,
            cursorAfter: result.cursorAfter,
          },
          cursor: result.cursorAfter,
        },
      });
    },
  });

  registerTool(server, {
    name: 'discover_serial_ports',
    description: 'Enumerate currently available serial ports (one-shot, no polling).',
    sensitivity: 'read-only',
    inputSchema: discoverSerialPortsInputSchema,
    handler: async (_input: DiscoverSerialPortsInput): Promise<ToolHandlerResult> => {
      const ports = await serialDiscovery.listPorts();
      return successOk({
        evidence: {
          kind: 'terminal_output',
          data: { ports },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'get_session_status',
    description: 'Get the current state of a session and the latest transcript cursor.',
    sensitivity: 'read-only',
    inputSchema: getSessionStatusInputSchema,
    handler: (input: GetSessionStatusInput): ToolHandlerResult => {
      const session = requireSession(sessionManager, input.sessionId);
      const cursor = latestCursor(session);
      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: { sessionId: session.id, state: session.state, cursor },
          cursor,
        },
      });
    },
  });
}

/** open_session 的工厂分支已抽到 `src/main/session-factory.ts`，由 IPC 与 MCP 共用。 */

function requireSession(manager: SessionManager, id: string): ISession {
  const session = manager.get(id);
  if (!session) {
    throw new ToolError(ERROR_CODES.SESSION_NOT_FOUND, `Session not found: ${id}`, { sessionId: id });
  }
  return session;
}

/** 把 decodeDataPayload 的错误归一化为 INVALID_ARGUMENT —— 避免 Buffer.from 宽容地吞掉非法 base64。 */
function decodeOrFail(payload: { encoding: 'utf-8' | 'base64'; data: string }): Uint8Array {
  try {
    return decodeDataPayload(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, message);
  }
}

function latestCursor(session: ISession): number {
  // 通过 read(0).cursor 获取当前最新 sequence；空 transcript 时返回 0。
  return session.read(0).cursor;
}

/**
 * 把 TranscriptEvent 序列化为 evidence 安全形态。
 *
 * Phase 6 评审 H3：MCP 与 IPC 共享 `serializeTranscriptEvent`，输出统一含 `dataBase64`
 * 字段（取代旧的 `data + dataEncoding`），避免两条通道 schema 漂移。AI 客户端读取
 * `dataBase64` 与渲染端逻辑一致。
 */
function serializeEvent(event: TranscriptEvent): Record<string, unknown> {
  return serializeTranscriptEvent(event) as unknown as Record<string, unknown>;
}

/**
 * 抹掉错误消息中可能出现的密码 / 私钥 / passphrase 片段。
 *
 * 这是兜底防线 —— SshTransport 已经在 open() 第一个 await 之前清空 credentials，
 * 但下游错误链路（DNS / 认证失败）可能在消息中夹带，统一用 placeholder 替换。
 *
 * @param message 原始错误消息
 * @param input  当前 open_session 的入参，用于按值精准 redact 凭据字符串
 */
function redactSensitive(message: string, input?: OpenSessionInput): string {
  let redacted = message.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]',
  );

  if (input && input.config.type === 'ssh') {
    const creds = input.config.credentials;
    const secrets: string[] = [];
    if (creds.kind === 'password') {
      secrets.push(creds.password);
    } else {
      // privateKey 已被 PEM 正则覆盖，但短句 / 单行格式可能漏；连同 passphrase 一起精确替换
      if (typeof creds.privateKey === 'string') secrets.push(creds.privateKey);
      if (creds.passphrase) secrets.push(creds.passphrase);
    }
    for (const secret of secrets) {
      if (!secret) continue;
      // 按 secret 字面量替换；用 split/join 避免引入 RegExp 注入
      redacted = redacted.split(secret).join('[REDACTED]');
    }
  }
  return redacted;
}

/** 简化 ToolHandlerSuccess 构造，避免 8 处重复 `success: true`。 */
function successOk(value: Omit<ToolHandlerSuccess, 'success'>): ToolHandlerSuccess {
  return { success: true, ...value };
}
