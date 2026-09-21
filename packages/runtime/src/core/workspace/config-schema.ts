/** Zod schemas for workspace config. `.strict()` at every layer is the credential boundary. */

import { z } from 'zod';
import { WORKSPACE_SCHEMA_VERSION } from './types.js';

/**
 * 芯片型号 schema。
 *
 * 拒绝任何额外字段（`.strict()`）以阻止有人把 `serial.password` 之类的字段藏进 chip 节点。
 */
export const chipSchema = z
  .object({
    family: z.string().min(1),
    part: z.string().min(1),
  })
  .strict();

/** 烧录工具 schema。 */
export const flashSchema = z
  .object({
    tool: z.string().min(1),
    binary: z.string().min(1).optional(),
    baseAddress: z.number().int().nonnegative().optional(),
  })
  .strict();

/** 调试器 schema。 */
export const debugSchema = z
  .object({
    tool: z.string().min(1),
    connection: z.string().min(1).optional(),
  })
  .strict();

/** RTT schema。 */
export const rttSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.array(z.number().int().nonnegative()).optional(),
  })
  .strict();

/** 持久化串口 schema。 */
export const serialPersistedSchema = z
  .object({
    port: z.string().min(1),
    baudRate: z.number().int().positive(),
    mode: z.enum(['normal', 'terminal']),
  })
  .strict();

/**
 * 工作区根 schema。
 *
 * 根层也 `.strict()`：拒绝未知顶层字段（确保未来加新字段时必经一次显式 schema 改动 +
 * 版本号 bump 流程，而不是被任意 caller 静默写入）。
 */
export const workspaceConfigSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
    chip: chipSchema.optional(),
    flash: flashSchema.optional(),
    debug: debugSchema.optional(),
    rtt: rttSchema.optional(),
    serial: serialPersistedSchema.optional(),
  })
  .strict();

/**
 * `update_workspace_config` 工具 patch 入参 schema —— 5 类字段全部可选，但只要提供就要严格。
 *
 * 不允许 caller 通过 patch 改 schemaVersion（避免误升级）；如需迁移走专门工具。
 */
export const workspaceConfigPatchSchema = z
  .object({
    chip: chipSchema.optional(),
    flash: flashSchema.optional(),
    debug: debugSchema.optional(),
    rtt: rttSchema.optional(),
    serial: serialPersistedSchema.optional(),
  })
  .strict();

export type WorkspaceConfigPatch = z.infer<typeof workspaceConfigPatchSchema>;
