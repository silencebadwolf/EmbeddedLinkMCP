import { z } from 'zod';

const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

export const jlinkDeviceCatalogSearchInputSchema = z
  .object({
    ...commonSchema,
    query: z.string().optional(),
    vendor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const jlinkDeviceCatalogGetInputSchema = z
  .object({
    ...commonSchema,
    name: z.string().min(1),
  })
  .strict();

export type JLinkDeviceCatalogSearchInput = z.infer<typeof jlinkDeviceCatalogSearchInputSchema>;
export type JLinkDeviceCatalogGetInput = z.infer<typeof jlinkDeviceCatalogGetInputSchema>;
