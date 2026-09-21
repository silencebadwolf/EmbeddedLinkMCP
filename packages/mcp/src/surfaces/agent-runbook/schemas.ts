import { z } from 'zod';

const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

export const getAgentRunbookInputSchema = z
  .object({
    ...commonSchema,
    root: z.string().min(1).max(1024).optional(),
  })
  .strict();

export const getAppStatusInputSchema = z
  .object({
    ...commonSchema,
    root: z.string().min(1).max(1024).optional(),
  })
  .strict();

export type GetAgentRunbookInput = z.infer<typeof getAgentRunbookInputSchema>;
export type GetAppStatusInput = z.infer<typeof getAppStatusInputSchema>;
