import { z } from 'zod';
import { controlProfileSchema } from './control-profile-schema.js';
import { CONTROL_PROFILE_RECORDS_SCHEMA_VERSION } from './control-profile-record-types.js';

export const controlProfileRecordSourceSchema = z.enum(['manual', 'ai']);

export const controlProfileRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(128),
    root: z.string().min(1).max(2048),
    source: controlProfileRecordSourceSchema,
    profile: controlProfileSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const controlProfileRecordsFileSchema = z
  .object({
    schemaVersion: z.literal(CONTROL_PROFILE_RECORDS_SCHEMA_VERSION),
    records: z.array(controlProfileRecordSchema).max(200),
  })
  .strict();

export type ControlProfileRecordSchema = z.infer<typeof controlProfileRecordSchema>;
export type ControlProfileRecordsFileSchema = z.infer<typeof controlProfileRecordsFileSchema>;
