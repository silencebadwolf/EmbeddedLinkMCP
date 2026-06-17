/** Zod input schemas for control-profile MCP tools. */

import path from 'node:path';
import { z } from 'zod';
import { controlProfileBodySchema } from '../../../core/workspace/index.js';

/** 所有 control-profile 工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

const isSafeAbsoluteRoot = (p: string): boolean =>
  path.isAbsolute(p) && !p.split(/[\\/]+/u).includes('..');

const safeRootMessage = 'root must be an absolute path without ".." segments';

const requiredRoot = z
  .string()
  .min(1)
  .refine(isSafeAbsoluteRoot, { message: safeRootMessage });

/** init_control_profile 入参。 */
export const initControlProfileInputSchema = z
  .object({
    ...commonSchema,
    /** 工作区根目录绝对路径（caller 必须显式提供）。 */
    root: requiredRoot,
    /** 不含 schemaVersion 的控制配置主体。 */
    profile: controlProfileBodySchema,
    /** 已存在 control-profile.json 时是否强制覆盖；默认 false 报错。 */
    force: z.boolean().optional(),
  })
  .strict();

/** get_control_profile 入参。 */
export const getControlProfileInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
  })
  .strict();

/** inspect_control_profile 入参。 */
export const inspectControlProfileInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
  })
  .strict();

/** prepare_control_profile_questions 入参。 */
export const prepareControlProfileQuestionsInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
  })
  .strict();

/** apply_control_profile_answer 入参。 */
export const applyControlProfileAnswerInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
    /** 用户自然语言回答；工具只解析非敏感硬件事实。 */
    answer: z.string().min(1).max(4096),
  })
  .strict();

/** activate_control_profile 入参。 */
export const activateControlProfileInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
  })
  .strict();

export type InitControlProfileInput = z.infer<typeof initControlProfileInputSchema>;
export type GetControlProfileInput = z.infer<typeof getControlProfileInputSchema>;
export type InspectControlProfileInput = z.infer<typeof inspectControlProfileInputSchema>;
export type PrepareControlProfileQuestionsInput = z.infer<typeof prepareControlProfileQuestionsInputSchema>;
export type ApplyControlProfileAnswerInput = z.infer<typeof applyControlProfileAnswerInputSchema>;
export type ActivateControlProfileInput = z.infer<typeof activateControlProfileInputSchema>;
