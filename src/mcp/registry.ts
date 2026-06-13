/**
 * MCP 工具注册包装层。
 *
 * 职责：把项目内部的"业务 handler"（接收已校验的 input、返回 LinkTermToolResult）
 * 包装成 MCP SDK 期望的工具回调，统一处理：
 *
 * 1. **Zod 入参解析**（McpServer 已经会做，但这里返回类型化的 input）
 * 2. **schema 版本检查** —— 不匹配时直接短路成结构化 error
 * 3. **origin 硬编码** —— LinkTermToolResult 总是带 `origin: 'ai'`，不允许 handler 覆盖
 * 4. **异常归一化** —— 把所有 throw 翻译成稳定 error.code（NOT_FOUND / NOT_OPEN / INTERNAL）
 * 5. **CallToolResult 序列化** —— 同时输出 `content[]`（人类可读 text）与 `structuredContent`
 *    （MCP 客户端的结构化字段），保持 \"AI 既能 grep 文本也能机读字段\" 的对偶。
 *
 * 这样 8 个具体工具 handler 只需关注\"调 SessionManager + 装填 evidence\"本身。
 */

import type { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EvidenceKind, Origin } from '../shared/types.js';
import type { SequenceCursor } from '../core/transcript/types.js';
import {
  checkSchemaVersion,
  type ToolSensitivity,
  LINKTERM_MCP_SCHEMA_VERSION,
} from './versioning/version-check.js';

/**
 * 已知错误码集合。Handler 可以通过 {@link ToolError} 抛出已归类的错误；
 * 未归类异常会被吞成 `INTERNAL`，避免泄漏栈/凭据。
 */
export type ToolErrorCode =
  | 'NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'NOT_OPEN'
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'TIMEOUT'
  | 'NO_BACKEND'
  | 'VERSION_MISMATCH'
  | 'INTERNAL';

/**
 * Handler 内部用来抛出已归类的错误；registry 会把它转成 LinkTermToolResult.error。
 *
 * **不要把任何敏感字段塞进 message 或 details**（密码 / 私钥 / token）。
 */
export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** 成功结果中嵌入的结构化证据。 */
export interface ToolEvidence {
  kind: EvidenceKind;
  /** 证据主体；JSON 安全（非二进制；二进制经 base64 后放在 .data 字符串字段中）。 */
  data: unknown;
  /** 当前会话的 sequence cursor（无关联会话时为 0）。 */
  cursor: SequenceCursor;
  /** 可选元信息（warning、truncated 等）。 */
  meta?: Readonly<Record<string, unknown>>;
}

/** Handler 成功返回；origin 由 registry 强制赋值，不允许 handler 提供。 */
export interface ToolHandlerSuccess {
  success: true;
  sessionId?: string;
  state?: string;
  evidence: ToolEvidence;
}

/** Handler 失败返回；与 ToolError 互补使用（也可以 throw ToolError）。 */
export interface ToolHandlerFailure {
  success: false;
  sessionId?: string;
  state?: string;
  error: {
    code: ToolErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
}

export type ToolHandlerResult = ToolHandlerSuccess | ToolHandlerFailure;

/**
 * 经 registry 包装后向 MCP 客户端实际暴露的载荷形态。与 ToolHandler* 形态相同，
 * 只是额外强制了 `origin: 'ai'` 与 `correlationId` 字段。
 */
export interface LinkTermToolResult {
  success: boolean;
  sessionId?: string;
  state?: string;
  evidence?: ToolEvidence;
  error?: {
    code: ToolErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
  /** 调用方提供的 correlationId 原样回填（缺省时不存在该字段）。 */
  correlationId?: string;
  /** 硬编码常量；MCP 工具的来源永远是 ai。 */
  origin: Extract<Origin, 'ai'>;
  /** server 端声明的 schema 版本，便于客户端做兼容性诊断。 */
  schemaVersion: string;
}

/** 业务 handler 签名。input 已通过 Zod 校验。 */
export type ToolBusinessHandler<TInput> = (
  input: TInput,
) => Promise<ToolHandlerResult> | ToolHandlerResult;

/** 注册一个工具时的元描述。 */
export interface ToolDefinition<TSchema extends z.ZodType> {
  name: string;
  description: string;
  /** 该工具是否会改变会话/进程状态 —— 决定 schema mismatch 时是否拒绝。 */
  sensitivity: ToolSensitivity;
  /** Zod 入参 schema。 */
  inputSchema: TSchema;
  /** 业务 handler，input 是 inputSchema 解析后的类型。 */
  handler: ToolBusinessHandler<z.infer<TSchema>>;
}

/**
 * 把一个 ToolDefinition 注册到 McpServer。
 *
 * @param server McpServer 实例
 * @param def 工具定义
 */
export function registerTool<TSchema extends z.ZodType<{ correlationId?: string; clientSchemaVersion?: string }>>(
  server: McpServer,
  def: ToolDefinition<TSchema>,
): void {
  type Input = z.infer<TSchema>;

  // SDK registerTool 接受 ZodRawShape 或 AnySchema 作为 inputSchema。这里用 schema 自身的 .shape
  // （ZodObject）比较自然，因此约束 TSchema 必须是 ZodObject。下面通过 unknown 转一次类型，避免 SDK
  // 内部繁琐的泛型推断与项目自身 ZodObject 的微小差异。
  const inputSchemaForSdk = (def.inputSchema as unknown as { shape: Record<string, z.ZodType> }).shape;

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: inputSchemaForSdk,
    },
    async (rawArgs: Record<string, unknown>): Promise<CallToolResult> => {
      // SDK 已经把 args 按 inputSchema 校验过；这里只做强类型转换。
      const input = rawArgs as Input;
      const correlationId = input.correlationId;

      // 1) Schema 版本检查
      const versionCheck = checkSchemaVersion(input.clientSchemaVersion, def.sensitivity);
      if (!versionCheck.ok) {
        return toCallToolResult({
          success: false,
          error: {
            code: 'VERSION_MISMATCH',
            message: versionCheck.warning ?? 'Schema version mismatch',
            details: {
              serverVersion: versionCheck.serverVersion,
              clientVersion: versionCheck.clientVersion,
            },
          },
          correlationId,
          origin: 'ai',
          schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
        });
      }

      // 2) 业务 handler
      let result: ToolHandlerResult;
      try {
        result = await def.handler(input);
      } catch (err) {
        result = normalizeError(err);
      }

      // 3) read-only + version warning：把 warning 透传到 evidence.meta
      let evidence = result.success ? result.evidence : undefined;
      if (result.success && versionCheck.warning && evidence) {
        evidence = {
          ...evidence,
          meta: { ...(evidence.meta ?? {}), warning: versionCheck.warning },
        };
      }

      const payload: LinkTermToolResult = result.success
        ? {
            success: true,
            sessionId: result.sessionId,
            state: result.state,
            evidence,
            correlationId,
            origin: 'ai',
            schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
          }
        : {
            success: false,
            sessionId: result.sessionId,
            state: result.state,
            error: result.error,
            correlationId,
            origin: 'ai',
            schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
          };

      return toCallToolResult(payload);
    },
  );
}

/**
 * 把任意 throw 归一化为 ToolHandlerFailure。
 *
 * - {@link ToolError}：原样使用其 code/message/details
 * - 其它 Error：包装为 INTERNAL，message 保留为常规错误描述（不含敏感字段）
 * - 非 Error：toString 后包装
 */
function normalizeError(err: unknown): ToolHandlerFailure {
  if (err instanceof ToolError) {
    return {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
  }
  if (err instanceof Error) {
    return {
      success: false,
      error: { code: 'INTERNAL', message: err.message },
    };
  }
  return {
    success: false,
    error: { code: 'INTERNAL', message: String(err) },
  };
}

/**
 * 把 LinkTermToolResult 序列化为 MCP CallToolResult。
 *
 * MCP CallToolResult 既有 `content[]`（给人/AI 阅读的文本）也有 `structuredContent`
 * （结构化字段，便于 AI 通过 JSON 路径读取）。我们：
 * - structuredContent 完整放 LinkTermToolResult
 * - content[0] 放一段简短 JSON 字符串作为 fallback
 * - isError 置位用于失败结果
 *
 * @param payload 业务结果
 */
function toCallToolResult(payload: LinkTermToolResult): CallToolResult {
  const text = JSON.stringify(payload);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError: !payload.success,
  };
}
