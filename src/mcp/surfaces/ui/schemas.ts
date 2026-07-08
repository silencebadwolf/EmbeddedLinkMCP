/**
 * MCP UI surface 入参 Zod schema。
 *
 * 设计纲要：
 * 1. `ui_configure` 用 `discriminatedUnion('action', [...])` —— 每个 action 一份独立 schema，
 *    便于未来扩展，未知 action 同步报错。
 * 2. **每层 `.strict()`** —— prefill / outer / 各 action 都禁止未知键；与 workspace surface
 *    `.strict()` 一致，sshPassword/sshPrivateKey/sshPassphrase 这类敏感键被 schema 直接拒绝
 *    （runtime 不需要 refine）。这是 §4.4 / §5.1 安全红线在 schema 层的实现。
 * 3. `ui_screenshot` 入参当前仅含 commonSchema —— 多窗口 / 区域截图属于未来扩展（Phase 10 决策 Q4）。
 */

import { z } from 'zod';

/** 所有 UI 工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

/**
 * ConnectionDialog 11 公开字段 prefill schema。
 *
 * `.strict()` 保证 caller 把 `sshPassword` 偷渡进来时同步抛 ZodError → INVALID_ARGUMENT。
 * 字段类型与 ConnectionDialog `FormState` 一一对应：baudRate/sshPort 故意保留 string，
 * 与表单 `Input` 行为一致（提交时再 parseInt），避免 number/string 双向转换出错。
 */
export const nonSensitivePrefillSchema = z
  .object({
    type: z.enum(['serial', 'ssh', 'local-shell', 'rtt-log']).optional(),
    label: z.string().max(128).optional(),
    serialPort: z.string().max(256).optional(),
    baudRate: z
      .string()
      .max(16)
      .regex(/^\d+$/, 'baudRate must be a positive integer string')
      .optional(),
    serialMode: z.enum(['normal', 'terminal']).optional(),
    sshHost: z.string().max(255).optional(),
    sshPort: z
      .string()
      .max(8)
      .regex(/^\d+$/, 'sshPort must be a positive integer string')
      .optional(),
    sshUsername: z.string().max(64).optional(),
    sshAuth: z.enum(['password', 'privateKey']).optional(),
    localShell: z.string().max(256).optional(),
    localCwd: z.string().max(1024).optional(),
    rttRoot: z.string().max(1024).optional(),
    rttProbeId: z.string().max(128).optional(),
    rttChannel: z
      .string()
      .max(8)
      .regex(/^\d+$/, 'rttChannel must be a non-negative integer string')
      .optional(),
  })
  .strict();

/** `set_locale` action：切换 UI 语言。 */
const setLocaleActionSchema = z
  .object({
    action: z.literal('set_locale'),
    locale: z.enum(['en', 'zh']),
  })
  .strict();

/** `set_connection_type` action：仅写 prefill.type；当前打开的 dialog 不被覆盖（保护用户输入）。 */
const setConnectionTypeActionSchema = z
  .object({
    action: z.literal('set_connection_type'),
    type: z.enum(['serial', 'ssh', 'local-shell', 'rtt-log']),
  })
  .strict();

/** `open_connection_dialog` action：可选 prefill 应用到表单。 */
const openConnectionDialogActionSchema = z
  .object({
    action: z.literal('open_connection_dialog'),
    prefill: nonSensitivePrefillSchema.optional(),
  })
  .strict();

/** `close_connection_dialog` action：清空 prefill 并关闭。 */
const closeConnectionDialogActionSchema = z
  .object({
    action: z.literal('close_connection_dialog'),
  })
  .strict();

/** ui_configure 的判别联合 patch。 */
export const uiConfigurePatchSchema = z.discriminatedUnion('action', [
  setLocaleActionSchema,
  setConnectionTypeActionSchema,
  openConnectionDialogActionSchema,
  closeConnectionDialogActionSchema,
]);

/** ui_configure 工具入参。 */
export const uiConfigureInputSchema = z
  .object({
    ...commonSchema,
    patch: uiConfigurePatchSchema,
  })
  .strict();

/** ui_screenshot 工具入参。Phase 10：仅整窗，无 windowId / rect。 */
export const uiScreenshotInputSchema = z.object({ ...commonSchema }).strict();

export type UiConfigureInput = z.infer<typeof uiConfigureInputSchema>;
export type UiConfigurePatch = z.infer<typeof uiConfigurePatchSchema>;
export type UiScreenshotInput = z.infer<typeof uiScreenshotInputSchema>;
export type NonSensitivePrefillSchema = z.infer<typeof nonSensitivePrefillSchema>;
