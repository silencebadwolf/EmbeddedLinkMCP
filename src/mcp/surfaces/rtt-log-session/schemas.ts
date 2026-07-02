import { z } from 'zod';

const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

const probeIdField = z.string().min(1).max(128);
const rootField = z.string().min(1).max(4096);

export const openRttLogSessionInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField.optional(),
    root: rootField.optional(),
    channelIndex: z.number().int().nonnegative().default(0),
    pollIntervalMs: z.number().int().min(10).max(10_000).default(100),
    maxBytesPerRead: z.number().int().positive().max(64 * 1024).default(4096),
    label: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.probeId === undefined && value.root === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['probeId'],
        message: 'probeId or root is required',
      });
    }
    if (value.probeId !== undefined && value.root !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['root'],
        message: 'probeId and root are mutually exclusive',
      });
    }
  });

export type OpenRttLogSessionInput = z.infer<typeof openRttLogSessionInputSchema>;
