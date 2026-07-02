/** Zod schemas for workspace-local control profile. Strict schemas are the credential boundary. */

import { z } from 'zod';
import { CONTROL_PROFILE_SCHEMA_VERSION } from './control-profile-types.js';

/** 十六进制地址字符串，如 "0x08000000"；禁止十进制字符串和 number。 */
export const hexAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, 'baseAddress must be a hexadecimal string like 0x08000000');

/** 串口快速拉起配置 schema。 */
export const controlSerialProfileSchema = z
  .object({
    enabled: z.boolean(),
    port: z.string().min(1).max(256).optional(),
    baudRate: z.number().int().positive().max(10_000_000).optional(),
    mode: z.enum(['normal', 'terminal']).optional(),
  })
  .strict();

/** J-Link 快速拉起配置 schema。 */
export const controlJLinkProfileSchema = z
  .object({
    enabled: z.boolean(),
    target: z.string().min(1).max(64).optional(),
    interface: z.enum(['swd', 'jtag']).optional(),
    speedKHz: z.union([z.literal('auto'), z.number().int().positive().max(50_000)]).optional(),
  })
  .strict();

/** Flash 事实配置 schema；激活不执行烧录。 */
export const controlFlashProfileSchema = z
  .object({
    binary: z.string().min(1).max(1024).optional(),
    baseAddress: hexAddressSchema.optional(),
    verify: z.boolean().optional(),
  })
  .strict();

/** RTT 快速拉起配置 schema。 */
export const controlRttProfileSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.array(z.number().int().nonnegative()).max(16).optional(),
    controlBlockAddress: hexAddressSchema.optional(),
  })
  .strict();

/** init/update payload：caller 不允许写 schemaVersion，由 manager 统一补齐。 */
export const controlProfileBodySchema = z
  .object({
    serial: controlSerialProfileSchema.optional(),
    jlink: controlJLinkProfileSchema.optional(),
    flash: controlFlashProfileSchema.optional(),
    rtt: controlRttProfileSchema.optional(),
  })
  .strict()
  .superRefine(requireExclusiveObservationChannel);

/** 完整持久化 control-profile.json schema。 */
export const controlProfileSchema = z
  .object({
    schemaVersion: z.literal(CONTROL_PROFILE_SCHEMA_VERSION),
    serial: controlSerialProfileSchema.optional(),
    jlink: controlJLinkProfileSchema.optional(),
    flash: controlFlashProfileSchema.optional(),
    rtt: controlRttProfileSchema.optional(),
  })
  .strict()
  .superRefine(requireExclusiveObservationChannel);

export type ControlProfileBody = z.infer<typeof controlProfileBodySchema>;

function requireExclusiveObservationChannel(
  profile: { serial?: { enabled: boolean }; rtt?: { enabled: boolean } },
  ctx: z.RefinementCtx,
): void {
  if (profile.serial?.enabled === true && profile.rtt?.enabled === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['rtt'],
      message: 'serial and RTT log observation cannot both be enabled',
    });
  }
}
