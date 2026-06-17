/** Zod schemas for high-level control workflow MCP tools. */

import path from 'node:path';
import { z } from 'zod';
import { hexAddressSchema } from '../../../core/workspace/index.js';

/** 所有 control-workflow 工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

const isSafeAbsoluteRoot = (p: string): boolean =>
  path.isAbsolute(p) && !p.split(/[\\/]+/u).includes('..');

const requiredRoot = z
  .string()
  .min(1)
  .refine(isSafeAbsoluteRoot, { message: 'root must be an absolute path without ".." segments' });

/** run_control_workflow 支持的工作流模式。 */
export const controlWorkflowModeSchema = z.enum([
  'flash-observe',
  'debug-diagnose',
  'flash-observe-diagnose',
]);

/** run_control_workflow 入参。 */
export const runControlWorkflowInputSchema = z
  .object({
    ...commonSchema,
    root: requiredRoot,
    mode: controlWorkflowModeSchema,
    firmware: z
      .object({
        filePath: z.string().min(1).max(1024).optional(),
        baseAddress: hexAddressSchema.optional(),
        verify: z.boolean().optional(),
      })
      .strict()
      .optional(),
    observe: z
      .object({
        serial: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(120_000).optional(),
        markers: z.array(z.string().min(1).max(256)).max(16).optional(),
        clearBeforeObserve: z.boolean().optional(),
      })
      .strict()
      .optional(),
    debug: z
      .object({
        readRegisters: z.boolean().optional(),
        readMemory: z
          .array(
            z
              .object({
                address: z.number().int().nonnegative(),
                length: z.number().int().positive().max(4096),
              })
              .strict(),
          )
          .max(8)
          .optional(),
        rttRead: z.boolean().optional(),
        haltOnFailure: z.boolean().optional(),
      })
      .strict()
      .optional(),
    confirm: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type RunControlWorkflowInput = z.infer<typeof runControlWorkflowInputSchema>;
