/** MCP workspace surface (init/get/update). Thin wrapper over WorkspaceConfigManager. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError } from 'zod';
import {
  WorkspaceAlreadyInitializedError,
  WorkspaceConfigManager,
  WorkspaceConfigTooLargeError,
  WorkspaceConflictError,
  WorkspaceInvalidRootError,
  WorkspaceNotFoundError,
  WorkspaceSchemaVersionMismatchError,
  detectConflicts,
  type EvidenceSnapshot,
  REQUIRED_FIELDS,
} from '../../../core/workspace/index.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
} from '../../registry.js';
import {
  getWorkspaceConfigInputSchema,
  initWorkspaceInputSchema,
  updateWorkspaceConfigInputSchema,
  type GetWorkspaceConfigInput,
  type InitWorkspaceInput,
  type UpdateWorkspaceConfigInput,
} from './schemas.js';

/** registerWorkspaceTools 的依赖容器。 */
export interface WorkspaceToolsDeps {
  workspaceConfigManager: WorkspaceConfigManager;
  /**
   * 当前硬件证据快照回调；用于 get_workspace_config 计算 conflicts。
   * 与 manager 注入的 evidenceFn 同源（main 进程组装时传同一函数）。
   */
  evidenceFn: () => Promise<EvidenceSnapshot>;
}

/**
 * 把 3 个 MCP workspace 工具注册到给定的 McpServer。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖（workspaceConfigManager 必须与 main 进程同实例）
 */
export function registerWorkspaceTools(server: McpServer, deps: WorkspaceToolsDeps): void {
  const { workspaceConfigManager, evidenceFn } = deps;

  registerTool(server, {
    name: 'init_workspace',
    description:
      'Initialize a LinkTerm workspace at the given root directory. Creates ' +
      '<root>/.linkterm/config.json with the current schemaVersion. Use force=true ' +
      'to overwrite an existing workspace config (otherwise WORKSPACE_ALREADY_INITIALIZED).',
    sensitivity: 'state-affecting',
    inputSchema: initWorkspaceInputSchema,
    handler: async (input: InitWorkspaceInput): Promise<ToolHandlerResult> => {
      try {
        const config = await workspaceConfigManager.init(input.root, {
          force: input.force ?? false,
        });
        return {
          success: true,
          evidence: {
            kind: 'workspace_config',
            data: { root: input.root, config },
            cursor: 0,
            meta: {
              missingFields: REQUIRED_FIELDS.filter((k) => config[k] === undefined),
            },
          },
        };
      } catch (err) {
        translateWorkspaceError(err);
      }
    },
  });

  registerTool(server, {
    name: 'get_workspace_config',
    description:
      'Read the persisted workspace config at the given root, returning missingFields ' +
      'and current conflicts vs hardware evidence. If root is omitted, falls back to the ' +
      'most recently activated workspace; WORKSPACE_NOT_FOUND if neither is set.',
    sensitivity: 'read-only',
    inputSchema: getWorkspaceConfigInputSchema,
    handler: async (input: GetWorkspaceConfigInput): Promise<ToolHandlerResult> => {
      const root = input.root ?? workspaceConfigManager.getCurrent()?.root;
      if (root === undefined) {
        throw new ToolError(
          ERROR_CODES.WORKSPACE_NOT_FOUND,
          'No workspace root provided and no active workspace; call init_workspace first.',
        );
      }
      try {
        const config = await workspaceConfigManager.load(root);
        const evidence = await evidenceFn();
        const conflicts = detectConflicts(config, evidence);
        return {
          success: true,
          evidence: {
            kind: 'workspace_config',
            data: { root, config },
            cursor: 0,
            meta: {
              missingFields: conflicts.missingFields,
              conflicts: conflicts.conflicts,
            },
          },
        };
      } catch (err) {
        translateWorkspaceError(err);
      }
    },
  });

  registerTool(server, {
    name: 'update_workspace_config',
    description:
      'Shallow-merge a partial config (chip / flash / debug / rtt / serial) into the ' +
      'workspace config. Each provided key fully replaces the corresponding section. ' +
      'Returns the post-merge config and a conflict report. With validateOnly=true the ' +
      'changes are not persisted (dry-run). Sensitive fields (password / privateKey / etc.) ' +
      'are rejected by schema strict mode.',
    sensitivity: 'state-affecting',
    inputSchema: updateWorkspaceConfigInputSchema,
    handler: async (input: UpdateWorkspaceConfigInput): Promise<ToolHandlerResult> => {
      try {
        const result = await workspaceConfigManager.update(input.root, input.patch, {
          validateOnly: input.validateOnly ?? false,
        });
        return {
          success: true,
          evidence: {
            kind: 'workspace_config',
            data: { root: input.root, config: result.config },
            cursor: 0,
            meta: {
              conflicts: result.conflicts.conflicts,
              missingFields: result.conflicts.missingFields,
              persisted: !(input.validateOnly ?? false),
            },
          },
        };
      } catch (err) {
        translateWorkspaceError(err);
      }
    },
  });
}

/**
 * 把 workspace 域错误翻译为 ToolError 并抛出。永远 throw，不返回 —— 调用点用 `: never`
 * 类型让 TypeScript 知道 catch 之后无 fallthrough。
 *
 * **凭据红线**：ZodError 仅暴露 `issues[].path` + `issues[].message`，不回显 caller 提供的 value。
 * WorkspaceConflictError 转 ToolError 时也会剥掉 `configured` / `actual` 等可能携带敏感 path 的字段。
 */
function translateWorkspaceError(err: unknown): never {
  if (err instanceof WorkspaceAlreadyInitializedError) {
    throw new ToolError(ERROR_CODES.WORKSPACE_ALREADY_INITIALIZED, err.message, {
      root: err.root,
    });
  }
  if (err instanceof WorkspaceNotFoundError) {
    throw new ToolError(ERROR_CODES.WORKSPACE_NOT_FOUND, err.message, {
      root: err.root,
    });
  }
  if (err instanceof WorkspaceConflictError) {
    // 仅保留稳定可展示的字段，剥掉 configured/actual（可能携带串口路径或将来凭据相邻值）。
    const safeConflicts = err.report.conflicts.map((c) => ({
      field: c.field,
      severity: c.severity,
      message: c.message,
    }));
    throw new ToolError(ERROR_CODES.WORKSPACE_CONFLICT, err.message, {
      report: {
        conflicts: safeConflicts,
        missingFields: err.report.missingFields,
      },
    });
  }
  if (err instanceof WorkspaceInvalidRootError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
      root: err.root,
    });
  }
  if (err instanceof WorkspaceConfigTooLargeError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
      root: err.root,
      size: err.size,
    });
  }
  if (err instanceof WorkspaceSchemaVersionMismatchError) {
    throw new ToolError(ERROR_CODES.WORKSPACE_SCHEMA_VERSION_MISMATCH, err.message, {
      expected: err.expected,
      actual: err.actual,
      root: err.root,
    });
  }
  if (err instanceof ZodError) {
    // 仅取 path + message + code；不回显 value（避免泄漏 caller patch 中的敏感字段值）。
    const safeIssues = err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    }));
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid workspace config payload', {
      issues: safeIssues,
    });
  }
  if (err instanceof SyntaxError) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Workspace config file is not valid JSON: ${err.message}`,
    );
  }
  throw err;
}
