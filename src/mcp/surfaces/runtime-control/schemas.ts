import { z } from 'zod';

const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

const confirmField = z
  .boolean()
  .optional()
  .describe('Must be true to schedule a LinkTerm MCP runtime restart.');

export const restartMcpRuntimeInputSchema = z
  .object({
    ...commonSchema,
    confirm: confirmField,
    delayMs: z.number().int().min(100).max(5_000).optional(),
  })
  .strict();

export type RestartMcpRuntimeInput = z.infer<typeof restartMcpRuntimeInputSchema>;
