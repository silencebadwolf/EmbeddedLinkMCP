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
import type { EventEmitter } from 'node:events';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { ISession } from '../../../core/session/types.js';
import { SessionNotOpenError } from '../../../core/session/types.js';
import type { TranscriptEvent } from '../../../core/transcript/types.js';
import type { SerialDiscovery } from '../../../transports/serial/serial-discovery.js';
import { SerialSession } from '../../../transports/serial/serial-session.js';
import { SshSession } from '../../../transports/ssh/ssh-session.js';
import { LocalShellSession } from '../../../transports/local-shell/local-shell-session.js';
import type { SshHostVerifier, SshCredentials } from '../../../transports/ssh/ssh-client-like.js';
import { DEFAULT_TIMEOUT_MS } from '../../../shared/constants.js';
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
    description: 'List all active session ids and their states.',
    sensitivity: 'read-only',
    inputSchema: listSessionsInputSchema,
    handler: (_input: ListSessionsInput): ToolHandlerResult => {
      const sessions = sessionManager.list().map((id) => {
        const sess = sessionManager.get(id);
        return { sessionId: id, state: sess?.state ?? 'closed' };
      });
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
        session = await sessionManager.createAndOpen((id) => buildSession(id, input));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError(
          'INTERNAL',
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
          throw new ToolError('NOT_OPEN', err.message, {
            sessionId: input.sessionId,
            state: err.sessionState,
          });
        }
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('is not open')) {
          throw new ToolError('NOT_OPEN', message, { sessionId: input.sessionId, state: session.state });
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
      'Write bytes to a session and wait for the next device output (or timeout). ' +
      'Phase 4 baseline: resolves on the first transport "data" event with origin=device. ' +
      'Cross-chunk completion-marker matching is added in Phase 7 with terminal rules.',
    sensitivity: 'state-affecting',
    inputSchema: sendAndWaitInputSchema,
    handler: async (input: SendAndWaitInput): Promise<ToolHandlerResult> => {
      const session = requireSession(sessionManager, input.sessionId);
      const data = decodeOrFail(input.payload);
      const cursorBefore = latestCursor(session);
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const waiter = waitForDeviceOutput(session, timeoutMs);
      try {
        await sessionManager.write(input.sessionId, data, {
          origin: 'ai',
          correlationId: input.correlationId,
        });
      } catch (err) {
        waiter.cancel();
        throw err;
      }

      const outcome = await waiter.promise;
      if (outcome.kind === 'timeout') {
        throw new ToolError('TIMEOUT', `Timed out waiting for device output after ${timeoutMs}ms`, {
          sessionId: session.id,
          cursorBefore,
          timeoutMs,
        });
      }

      return successOk({
        sessionId: session.id,
        state: session.state,
        evidence: {
          kind: 'terminal_output',
          data: {
            bytesWritten: data.byteLength,
            firstResponseSequence: outcome.event.sequence,
            firstResponseEvent: serializeEvent(outcome.event),
          },
          cursor: outcome.event.sequence,
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

/** open_session 的工厂分支：按 type 构造对应 ISession。 */
function buildSession(id: string, input: OpenSessionInput): ISession {
  const cfg = input.config;
  switch (cfg.type) {
    case 'serial':
      return new SerialSession({
        id,
        config: {
          type: 'serial',
          port: cfg.port,
          baudRate: cfg.baudRate,
          mode: cfg.mode,
          dataBits: cfg.dataBits,
          stopBits: cfg.stopBits,
          parity: cfg.parity,
          rtscts: cfg.rtscts,
          xon: cfg.xon,
          xoff: cfg.xoff,
          label: cfg.label,
        },
      });
    case 'ssh': {
      const credentials: SshCredentials =
        cfg.credentials.kind === 'password'
          ? { kind: 'password', password: cfg.credentials.password }
          : {
              kind: 'privateKey',
              privateKey: cfg.credentials.privateKey,
              passphrase: cfg.credentials.passphrase,
            };
      // Phase 4：MCP 入口不暴露任何"信任未知主机"开关 —— 无 known_hosts 持久层，统一拒绝。
      // Phase 8 引入持久化信任后会改为按指纹比对。这里保持显式 reject 而非 throw，让上层
      // SshTransport 走标准 error 路径，并在 transcript 中留下完整审计。
      const hostVerifier: SshHostVerifier = () => false;
      return new SshSession({
        id,
        config: {
          type: 'ssh',
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          keepaliveIntervalMs: cfg.keepaliveIntervalMs,
          readyTimeoutMs: cfg.readyTimeoutMs,
          term: cfg.term,
          rows: cfg.rows,
          cols: cfg.cols,
          label: cfg.label,
        },
        credentials,
        hostVerifier,
      });
    }
    case 'local-shell':
      return new LocalShellSession({
        id,
        config: {
          type: 'local-shell',
          shell: cfg.shell,
          args: cfg.args,
          cwd: cfg.cwd,
          env: cfg.env,
          term: cfg.term,
          rows: cfg.rows,
          cols: cfg.cols,
          label: cfg.label,
        },
      });
  }
}

/**
 * 等待 session 下一条 origin='device' 的 data 事件；若 timeoutMs 内未到则返回 timeout。
 *
 * 通过订阅 session 'event' 而非 transport.on('data') —— 保证经过 transcript 序列化，
 * 与 §4.4 \"MCP 不直接接触 transport\" 一致。
 */
function waitForDeviceOutput(
  session: ISession,
  timeoutMs: number,
): {
  promise: Promise<{ kind: 'event'; event: TranscriptEvent } | { kind: 'timeout' }>;
  cancel: () => void;
} {
  let resolveFn: (
    value: { kind: 'event'; event: TranscriptEvent } | { kind: 'timeout' },
  ) => void = () => undefined;
  let timer: NodeJS.Timeout | null = null;
  let listener: ((event: TranscriptEvent) => void) | null = null;
  let resolved = false;

  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (listener) {
      // ISession 的公开接口仅声明 on(...)，但实现继承自 EventEmitter；
      // 通过 cast 取得 off 来解订阅，与 SessionManager 内部用法一致。
      (session as unknown as EventEmitter).off('event', listener);
    }
    listener = null;
  };

  const promise = new Promise<{ kind: 'event'; event: TranscriptEvent } | { kind: 'timeout' }>(
    (resolve) => {
      resolveFn = (value) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      };
      listener = (event: TranscriptEvent): void => {
        if (event.type === 'data' && event.origin === 'device') {
          resolveFn({ kind: 'event', event });
        }
      };
      session.on('event', listener);
      timer = setTimeout(() => resolveFn({ kind: 'timeout' }), timeoutMs);
    },
  );

  return {
    promise,
    cancel: () => resolveFn({ kind: 'timeout' }),
  };
}

function requireSession(manager: SessionManager, id: string): ISession {
  const session = manager.get(id);
  if (!session) {
    throw new ToolError('NOT_FOUND', `Session not found: ${id}`, { sessionId: id });
  }
  return session;
}

/** 把 decodeDataPayload 的错误归一化为 INVALID_ARGUMENT —— 避免 Buffer.from 宽容地吞掉非法 base64。 */
function decodeOrFail(payload: { encoding: 'utf-8' | 'base64'; data: string }): Uint8Array {
  try {
    return decodeDataPayload(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError('INVALID_ARGUMENT', message);
  }
}

function latestCursor(session: ISession): number {
  // 通过 read(0).cursor 获取当前最新 sequence；空 transcript 时返回 0。
  return session.read(0).cursor;
}

/** 把 TranscriptEvent 序列化为 JSON 安全形态：data 字段用 base64 编码。 */
function serializeEvent(event: TranscriptEvent): Record<string, unknown> {
  const { type, origin, evidenceKind, sequence, timestamp, meta, data } = event;
  return {
    type,
    origin,
    evidenceKind,
    sequence,
    timestamp,
    meta,
    data: data ? Buffer.from(data).toString('base64') : undefined,
    dataEncoding: data ? ('base64' as const) : undefined,
  };
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
