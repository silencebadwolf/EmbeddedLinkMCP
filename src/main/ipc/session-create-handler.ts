/**
 * IPC `session:create` handler。
 *
 * 与 MCP `open_session` 工具共用 {@link buildSession}，确保两条入口（人 / AI）
 * 创建的 session 走完全相同的 transport 实例化路径与默认值。
 *
 * 行为差异（与 MCP 工具的对照）：
 * - MCP `open_session` 把 open 失败翻译为 `ToolError('INTERNAL')`，让 AI 端立即重试；
 * - IPC `session:create` 即便 open 失败也返回 `{success: true}`，session 进入 manager
 *   并以 `state='errored'` 暴露给渲染端。这是为 UI tab bar 服务的：让用户能看到失败 tab
 *   并按 close → 重新打开自己处理，而不是让 invoke 抛错被 React error boundary 吃掉。
 *
 * 安全不变量：
 * - 渲染端不可越过 SessionManager 直接接触 transport（§4.4）—— 本 handler 仅做参数校验
 *   与 buildSession 装配，不旁路 transport。
 * - `sessionId` / `label` 是渲染端的便利字段，但 manager 强制使用自己的 `sess_<uuid>` 形式 id
 *   作为权威值；客户端字段视为忽略，避免渲染端伪造已有 id。
 */

import { electron } from '../electron-runtime.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import {
  SerialSessionConflictError,
  SerialSessionCoordinator,
} from '../../core/session/serial-session-coordinator.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { SessionId, SessionState } from '../../shared/types.js';
import type {
  SessionCreateRequestConfig,
  PreloadResult,
} from '../../shared/preload-api.js';
import { openSessionInputSchema } from '../../mcp/surfaces/terminal/schemas.js';
import { createAndOpenSession } from './session-open-helper.js';

const { ipcMain } = electron;

/** session:create 的入参契约。`sessionId`/`label` 是 UI 便利字段（label 进 config.label）。 */
interface SessionCreateRequest {
  config: SessionCreateRequestConfig;
  /** 仅作日志/调试参考；权威 id 由 SessionManager 内部分配。 */
  sessionId?: string;
  /** UI 显示名；若未在 config.label 中提供，会被合并到 config.label。 */
  label?: string;
}

/** session:create 的结构化响应（与 wrap() 输出对齐）。 */
type SessionCreateResult = PreloadResult<{ sessionId: SessionId; state: SessionState }>;

/**
 * 注册 `session:create` 单一 IPC handler。
 *
 * 与 `session-ipc.ts` 中其余 handler 平级（保持每个 handler 专职单一文件，便于测试单独装配）。
 *
 * @param sessionManager 与 MCP server 共享的 SessionManager 实例
 * @returns 反注册函数：移除 ipcMain handler（用于测试 teardown 与退出）
 */
export function registerSessionCreate(
  sessionManager: SessionManager,
  serialSessionCoordinator: SerialSessionCoordinator = new SerialSessionCoordinator(sessionManager),
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.SESSION_CREATE,
    async (_event, raw: SessionCreateRequest): Promise<SessionCreateResult> => {
      // 1) 参数校验：复用 MCP 的 openSession schema，强制接收同样的字段集合
      const parsed = openSessionInputSchema.safeParse({
        config: mergeLabel(raw?.config, raw?.label),
      });
      if (!parsed.success) {
        return {
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues
              .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
              .join('; '),
          },
        };
      }

      const input = parsed.data;
      // 经 zod 校验后的 input.config 结构与 SessionCreateRequestConfig 一致（含 SSH credentials）；
      // 这一层断言把 zod 推断的匿名联合类型显式落到 shared 命名类型，便于跨入口共享 buildSession。
      const config = input.config as unknown as SessionCreateRequestConfig;

      try {
        const data = await createAndOpenSession(
          sessionManager,
          config,
          undefined,
          serialSessionCoordinator,
        );

        return {
          success: true,
          data,
        };
      } catch (err) {
        if (err instanceof SerialSessionConflictError) {
          return {
            success: false,
            error: {
              code: err.code,
              message: err.message,
              details: {
                port: err.port,
                existingSessionId: err.existingSessionId,
                existing: err.existing,
                requested: err.requested,
              },
            },
          };
        }
        // 仅当 manager 入注册阶段抛错时落入此分支（重复 id / factory 校验失败 / buildSession 异常）
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: { code: 'INTERNAL', message },
        };
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_CREATE);
  };
}

/**
 * 把 request.label 合并到 config.label（仅当 config.label 缺省时）。
 *
 * 这样渲染端可以在两处任一指定 label，避免重复字段歧义。
 */
function mergeLabel(
  config: SessionCreateRequest['config'] | undefined,
  fallbackLabel: string | undefined,
): SessionCreateRequest['config'] | undefined {
  if (!config) return config;
  if (config.label !== undefined || fallbackLabel === undefined) return config;
  return { ...config, label: fallbackLabel };
}

/** 测试用导出：让 main 进程之外的工具消费同一类型契约。 */
export type { SessionCreateRequest, SessionCreateResult };
