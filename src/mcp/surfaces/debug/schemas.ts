/**
 * MCP debug surface 的 28 个工具入参 Zod schema。
 *
 * 设计原则：
 * 1. **probeId 一律 UUID v4**：与 SessionId 风格一致，序列号绝不暴露在传输层；
 * 2. **二进制走 base64 字段**：MCP 协议是 JSON；解码与上限校验由
 *    `binary-codec.decodeBase64Capped` 统一处理；
 * 3. **timeoutMs 仅出现在长操作**（flash / GDB start）：通过 `abortableMixin` 复用；
 * 4. **sensitivity 注解写在 tools.ts 注册时**，不放进 schema —— 一种工具一份分类；
 * 5. **每个 z.object 都 `.strict()`**：未知字段同步抛错，与 workspace surface 一致，
 *    避免 caller 偷渡未文档化的 key。
 */

import { z } from 'zod';
import { MAX_BASE64_INPUT_LEN } from '../../limits.js';

/** 所有工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

/** 长操作可选超时；上限 10 分钟。 */
const abortableMixin = {
  timeoutMs: z.number().int().positive().max(600_000).optional(),
};

/** probeId 必须是 UUID v4 字符串。 */
const probeIdField = z.string().uuid();

/** Optional workspace root whose .linkterm/control-profile.json constrains direct flash tools. */
const profileRootField = z.string().min(1).max(4096).optional();

/**
 * 高影响操作（flash_* / cpu_reset / gdb_server_start）的 confirm 闸门字段。
 *
 * Phase 12：MCP 表层把它做成 `optional boolean`，让 zod 始终接受入参；真正的
 * `confirm !== true` 拒绝由 tools.ts entry 在调 backend 之前显式抛
 * {@link ConfirmationRequiredError}，由 `runJLink` 翻译为 `CONFIRMATION_REQUIRED`
 * ToolError。这样 AI 客户端能区分"参数错"vs"需要二次确认"。
 *
 * 字段名直接叫 `confirm` 是有意为之 —— 与 git push --force-with-lease / kubectl
 * delete --force 等"用户主动确认"语义保持一致；不要改成 `acknowledged`/`force`
 * 这样的别名造成跨工具不一致。
 */
const confirmField = z
  .boolean()
  .optional()
  .describe(
    'Must be true to execute this high-impact operation. Set false or omit to abort with CONFIRMATION_REQUIRED.',
  );

/** base64 字符串字段：用于非确认门工具，schema 层先限制字符集和长度。 */
const base64Field = z
  .string()
  .min(1)
  .max(MAX_BASE64_INPUT_LEN)
  .regex(/^[A-Za-z0-9+/=\r\n\t ]+$/, 'must be base64');

/**
 * 高影响二进制字段：未确认时必须先返回 CONFIRMATION_REQUIRED，不能暴露 base64
 * 解析或大小细节；确认后的严格校验和上限由 decodeBase64Capped 负责。
 */
const highImpactBase64Field = z.string().min(1);

/** 32 位地址字段；非负整数。 */
const addressField = z.number().int().nonnegative();

/** 寄存器名（如 "r0" / "pc"）。 */
const registerNameField = z.string().min(1).max(32);

// =====================================================================
// probe lifecycle
// =====================================================================

export const probeDetectInputSchema = z.object({ ...commonSchema }).strict();

export const probeConnectInputSchema = z
  .object({
    ...commonSchema,
    /** 设备名（必填），J-Link Commander 的 device 参数。 */
    target: z.string().min(1).max(64),
    interface: z.enum(['swd', 'jtag']).optional(),
    speedKHz: z.number().int().positive().max(50_000).optional(),
    serialNumber: z.string().min(1).max(64).optional(),
  })
  .strict();

export const probeDisconnectInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

export const probeStatusInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

// =====================================================================
// cpu control
// =====================================================================

export const cpuResetInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    halt: z.boolean().optional(),
    confirm: confirmField,
  })
  .strict();

export const cpuHaltInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

export const cpuRunInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

export const cpuStepInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

// =====================================================================
// breakpoints
// =====================================================================

export const breakpointSetInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    address: addressField,
    kind: z.enum(['sw', 'hw']).optional(),
  })
  .strict();

export const breakpointClearInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    /** backend 分配的断点 id；非负整数。 */
    id: z.number().int().nonnegative(),
  })
  .strict();

export const breakpointListInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

// =====================================================================
// registers
// =====================================================================

export const registerReadInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    name: registerNameField,
  })
  .strict();

export const registerWriteInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    name: registerNameField,
    /** 寄存器值；JS number 受 53 bit 限制，足够 32 位寄存器表达。 */
    value: z.number().int(),
  })
  .strict();

export const registerListInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

// =====================================================================
// memory
// =====================================================================

export const memoryReadInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    address: addressField,
    /** 单次读取上限 16 MiB；超出由 backend 截断或抛 BUFFER_TOO_LARGE。 */
    length: z.number().int().positive().max(16 * 1024 * 1024),
  })
  .strict();

export const memoryWriteInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    address: addressField,
    /** 写入数据 base64 编码；服务器端解码上限 16 MiB。 */
    dataBase64: base64Field,
  })
  .strict();

// =====================================================================
// flash
// =====================================================================

export const flashDownloadInputSchema = z
  .object({
    ...commonSchema,
    ...abortableMixin,
    probeId: probeIdField,
    /** 烧录 binary 的 base64；确认后由 decodeBase64Capped 执行严格校验和 16 MiB 上限。 */
    binaryBase64: highImpactBase64Field,
    address: addressField.optional(),
    profileRoot: profileRootField,
    verify: z.boolean().optional(),
    confirm: confirmField,
  })
  .strict();

export const flashEraseInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    address: addressField.optional(),
    length: z.number().int().positive().optional(),
    confirm: confirmField,
  })
  .strict();

export const flashWriteInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    address: addressField,
    dataBase64: highImpactBase64Field,
    confirm: confirmField,
  })
  .strict();

export const flashVerifyInputSchema = z
  .object({
    ...commonSchema,
    ...abortableMixin,
    probeId: probeIdField,
    binaryBase64: base64Field,
    address: addressField.optional(),
    profileRoot: profileRootField,
  })
  .strict();

// =====================================================================
// RTT
// =====================================================================

export const rttConnectInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    controlBlockAddress: addressField.optional(),
  })
  .strict();

export const rttReadInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    channelIndex: z.number().int().nonnegative(),
    /** 一次读取上限；硬件读指针会被推进。 */
    maxBytes: z.number().int().positive().max(16 * 1024 * 1024),
  })
  .strict();

export const rttClearInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    channelIndex: z.number().int().nonnegative(),
  })
  .strict();

export const rttSearchInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    channelIndex: z.number().int().nonnegative(),
    /** 搜索文本；不支持正则（与 sendAndWait 区分）。 */
    pattern: z.string().min(1).max(4096),
    maxBytes: z.number().int().positive().max(16 * 1024 * 1024),
  })
  .strict();

// =====================================================================
// GDB
// =====================================================================

export const gdbServerStartInputSchema = z
  .object({
    ...commonSchema,
    ...abortableMixin,
    probeId: probeIdField,
    port: z.number().int().min(1).max(65_535).optional(),
    host: z.string().min(1).max(255).optional(),
    confirm: confirmField,
  })
  .strict();

export const gdbServerStopInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

// =====================================================================
// diagnostics
// =====================================================================

export const snapshotCaptureInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
    ranges: z
      .array(
        z
          .object({
            address: addressField,
            length: z.number().int().positive().max(16 * 1024 * 1024),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export const crashDiagnoseInputSchema = z
  .object({
    ...commonSchema,
    probeId: probeIdField,
  })
  .strict();

export const commanderScriptInputSchema = z
  .object({
    ...commonSchema,
    ...abortableMixin,
    probeId: probeIdField,
    commands: z.array(z.string().min(1).max(256)).min(1).max(64),
    confirm: confirmField,
  })
  .strict();

// =====================================================================
// inferred input types
// =====================================================================

export type ProbeDetectInput = z.infer<typeof probeDetectInputSchema>;
export type ProbeConnectInput = z.infer<typeof probeConnectInputSchema>;
export type ProbeDisconnectInput = z.infer<typeof probeDisconnectInputSchema>;
export type ProbeStatusInput = z.infer<typeof probeStatusInputSchema>;

export type CpuResetInput = z.infer<typeof cpuResetInputSchema>;
export type CpuHaltInput = z.infer<typeof cpuHaltInputSchema>;
export type CpuRunInput = z.infer<typeof cpuRunInputSchema>;
export type CpuStepInput = z.infer<typeof cpuStepInputSchema>;

export type BreakpointSetInput = z.infer<typeof breakpointSetInputSchema>;
export type BreakpointClearInput = z.infer<typeof breakpointClearInputSchema>;
export type BreakpointListInput = z.infer<typeof breakpointListInputSchema>;

export type RegisterReadInput = z.infer<typeof registerReadInputSchema>;
export type RegisterWriteInput = z.infer<typeof registerWriteInputSchema>;
export type RegisterListInput = z.infer<typeof registerListInputSchema>;

export type MemoryReadInput = z.infer<typeof memoryReadInputSchema>;
export type MemoryWriteInput = z.infer<typeof memoryWriteInputSchema>;

export type FlashDownloadInput = z.infer<typeof flashDownloadInputSchema>;
export type FlashEraseInput = z.infer<typeof flashEraseInputSchema>;
export type FlashWriteInput = z.infer<typeof flashWriteInputSchema>;
export type FlashVerifyInput = z.infer<typeof flashVerifyInputSchema>;

export type RttConnectInput = z.infer<typeof rttConnectInputSchema>;
export type RttReadInput = z.infer<typeof rttReadInputSchema>;
export type RttClearInput = z.infer<typeof rttClearInputSchema>;
export type RttSearchInput = z.infer<typeof rttSearchInputSchema>;

export type GdbServerStartInput = z.infer<typeof gdbServerStartInputSchema>;
export type GdbServerStopInput = z.infer<typeof gdbServerStopInputSchema>;

export type SnapshotCaptureInput = z.infer<typeof snapshotCaptureInputSchema>;
export type CrashDiagnoseInput = z.infer<typeof crashDiagnoseInputSchema>;
export type CommanderScriptInput = z.infer<typeof commanderScriptInputSchema>;
