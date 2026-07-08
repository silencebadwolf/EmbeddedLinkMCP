import { z } from 'zod';
import { CONNECTIONS_SCHEMA_VERSION } from './types.js';

const serialSavedConfigSchema = z
  .object({
    type: z.literal('serial'),
    port: z.string().min(1),
    baudRate: z.number().int().positive(),
    mode: z.enum(['normal', 'terminal']),
    dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
    stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
    parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
    rtscts: z.boolean().optional(),
    xon: z.boolean().optional(),
    xoff: z.boolean().optional(),
  })
  .strict();

const sshSavedConfigSchema = z
  .object({
    type: z.literal('ssh'),
    host: z.string().min(1),
    port: z.number().int().positive(),
    username: z.string().min(1),
    keepaliveIntervalMs: z.number().int().nonnegative().optional(),
    readyTimeoutMs: z.number().int().positive().optional(),
    term: z.string().optional(),
    rows: z.number().int().positive().optional(),
    cols: z.number().int().positive().optional(),
  })
  .strict();

const localShellSavedConfigSchema = z
  .object({
    type: z.literal('local-shell'),
    shell: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    term: z.string().optional(),
    rows: z.number().int().positive().optional(),
    cols: z.number().int().positive().optional(),
  })
  .strict();

const rttLogSavedConfigSchema = z
  .object({
    type: z.literal('rtt-log'),
    root: z.string().min(1),
    channelIndex: z.number().int().nonnegative(),
    pollIntervalMs: z.number().int().min(10).max(10_000).optional(),
    maxBytesPerRead: z.number().int().min(1).max(64 * 1024).optional(),
  })
  .strict();

export const savedConnectionConfigSchema = z.discriminatedUnion('type', [
  serialSavedConfigSchema,
  sshSavedConfigSchema,
  localShellSavedConfigSchema,
  rttLogSavedConfigSchema,
]);

const encryptedCredentialSchema = z
  .object({
    provider: z.literal('electron-safeStorage'),
    version: z.literal(1),
    ciphertextBase64: z.string().min(1).max(256 * 1024),
  })
  .strict();

export const savedConnectionProfileSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(128),
    type: z.enum(['serial', 'ssh', 'local-shell', 'rtt-log']),
    config: savedConnectionConfigSchema,
    encryptedCredential: encryptedCredentialSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine((profile) => profile.type === profile.config.type, {
    message: 'profile type must match config.type',
    path: ['type'],
  })
  .refine((profile) => profile.type === 'ssh' || profile.encryptedCredential === undefined, {
    message: 'encrypted credentials are only valid for ssh profiles',
    path: ['encryptedCredential'],
  });

export const connectionsFileSchema = z
  .object({
    schemaVersion: z.literal(CONNECTIONS_SCHEMA_VERSION),
    profiles: z.array(savedConnectionProfileSchema).max(200),
  })
  .strict();
