/** Zod schemas for high-level control workflow MCP tools. */

import path from 'node:path';
import { z } from 'zod';
import { hexAddressSchema } from '@linkterm/runtime/core/workspace/index';
import type { RunControlWorkflowInput as DomainWorkflowInput } from '@linkterm/runtime/core/control-workflow/input';

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

const backgroundExecutionSchema = z
  .object({
    mode: z.enum(['sync', 'background']),
  })
  .strict();

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
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      })
      .strict()
      .optional(),
    observe: z
      .object({
        enabled: z.boolean().optional(),
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
    /** Legacy compatibility flag; execution is never gated by this value. */
    confirm: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    execution: backgroundExecutionSchema.optional(),
  })
  .strict() satisfies z.ZodType<DomainWorkflowInput>;

export type RunControlWorkflowInput = z.infer<typeof runControlWorkflowInputSchema>;

const jobIdSchema = z.string().min(1).max(128);

export const controlWorkflowJobStatusInputSchema = z
  .object({
    ...commonSchema,
    jobId: jobIdSchema,
  })
  .strict();

export const controlWorkflowJobReadInputSchema = z
  .object({
    ...commonSchema,
    jobId: jobIdSchema,
  })
  .strict();

export const controlWorkflowJobCancelInputSchema = z
  .object({
    ...commonSchema,
    jobId: jobIdSchema,
  })
  .strict();

export const controlWorkflowJobCleanupInputSchema = z
  .object({
    ...commonSchema,
    jobId: jobIdSchema.optional(),
    expiredOnly: z.boolean().optional(),
  })
  .strict();

export type ControlWorkflowJobStatusInput = z.infer<typeof controlWorkflowJobStatusInputSchema>;
export type ControlWorkflowJobReadInput = z.infer<typeof controlWorkflowJobReadInputSchema>;
export type ControlWorkflowJobCancelInput = z.infer<typeof controlWorkflowJobCancelInputSchema>;
export type ControlWorkflowJobCleanupInput = z.infer<typeof controlWorkflowJobCleanupInputSchema>;
