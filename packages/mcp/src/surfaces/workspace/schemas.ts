/** Zod input schemas for workspace MCP tools. */

import path from 'node:path';
import { z } from 'zod';
import { workspaceConfigPatchSchema } from '@linkterm/runtime/core/workspace/index';

/** 所有 workspace 工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

/**
 * 校验路径必须是绝对路径且不含 ".." 段。
 *
 * 把校验下沉到 MCP 边界，未通过会自然走 ZodError → INVALID_ARGUMENT；core 层 `assertValidRoot`
 * 仍是防御性兜底。
 */
const isSafeAbsoluteRoot = (p: string): boolean =>
  path.isAbsolute(p) && !p.split(/[\\/]+/u).includes('..');

const safeRootMessage = 'root must be an absolute path without ".." segments';

const requiredRoot = z
  .string()
  .min(1)
  .refine(isSafeAbsoluteRoot, { message: safeRootMessage });

const optionalRoot = z
  .string()
  .min(1)
  .refine(isSafeAbsoluteRoot, { message: safeRootMessage })
  .optional();

/** init_workspace 入参。 */
export const initWorkspaceInputSchema = z.object({
  ...commonSchema,
  /** 工作区根目录绝对路径（caller 必须显式提供）。 */
  root: requiredRoot,
  /** 已存在 config.json 时是否强制覆盖；默认 false 报错。 */
  force: z.boolean().optional(),
});

/**
 * get_workspace_config 入参。root 可选 —— 缺省时回退到 manager 的 currentWorkspace；
 * 都没有时返回 WORKSPACE_NOT_FOUND。
 */
export const getWorkspaceConfigInputSchema = z.object({
  ...commonSchema,
  root: optionalRoot,
});

/** update_workspace_config 入参。 */
export const updateWorkspaceConfigInputSchema = z.object({
  ...commonSchema,
  root: requiredRoot,
  /** 5 类字段任意子集；schema `.strict()` 拒绝 password / token 等未知键。 */
  patch: workspaceConfigPatchSchema,
  /** 仅校验，不写盘；用于 dry-run 冲突检查。 */
  validateOnly: z.boolean().optional(),
});

export type InitWorkspaceInput = z.infer<typeof initWorkspaceInputSchema>;
export type GetWorkspaceConfigInput = z.infer<typeof getWorkspaceConfigInputSchema>;
export type UpdateWorkspaceConfigInput = z.infer<typeof updateWorkspaceConfigInputSchema>;
