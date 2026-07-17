/**
 * MCP 终端工具入参 Zod schema。
 *
 * 设计原则：
 * 1. **Origin 不可由调用方覆盖** —— 任何 MCP 工具的 origin 都在 server 端硬编码为 `'ai'`。
 *    schema 中**不**接收 origin 字段。
 * 2. **凭据/敏感字段在 schema 显式而非埋藏** —— SSH 密码 / 私钥放在 `credentials` 子对象，
 *    与 SshSessionConfig 严格分离；server 端只在创建 SshSession 那一行使用，不会被再次拷贝。
 *    （req §4.4 / §5.1）
 * 3. **每个工具都接受可选 `correlationId` 与 `clientSchemaVersion`** ——
 *    correlationId 进 transcript audit 元信息；clientSchemaVersion 由 version-check 处理。
 * 4. **数据字段一律 base64** —— MCP 协议是 JSON，二进制必须编码；server 端解码为 Uint8Array 入队。
 *    UTF-8 字符串 / base64 选择放在工具入参的 `encoding` 字段。
 */

import { z } from 'zod';

/** 字节数据的两种载体形式：UTF-8 文本 或 base64 编码。 */
const dataPayloadSchema = z.union([
  z.object({
    encoding: z.literal('utf-8'),
    data: z.string(),
  }),
  z.object({
    encoding: z.literal('base64'),
    data: z.string(),
  }),
]);

/** 所有工具共有的可选元字段。 */
const commonSchema = {
  correlationId: z.string().min(1).max(128).optional(),
  clientSchemaVersion: z.string().min(1).max(64).optional(),
};

/** 串口工作模式与配置子集 —— 与 `SerialSessionConfig` 一致；`type` 由判别字段隐含。 */
const serialOpenSchema = z.object({
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
  label: z.string().optional(),
});

/** SSH 凭据 —— 与 SshCredentials 联合一致。 */
const sshCredentialsSchema = z.union([
  z.object({
    kind: z.literal('password'),
    password: z.string().min(1),
  }),
  z.object({
    kind: z.literal('privateKey'),
    privateKey: z.string().min(1),
    passphrase: z.string().optional(),
  }),
]);

/** SSH open 入参；credentials 强制独立，不进 SshSessionConfig。 */
const sshOpenSchema = z.object({
  type: z.literal('ssh'),
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  credentials: sshCredentialsSchema,
  /**
   * Phase 4 不接受任何"未知主机"信任决策 —— 没有 known_hosts 持久层，hostVerifier 一律拒绝。
   * Phase 8 引入 known_hosts 后会暴露真正的信任入口（指纹比对 / TOFU 首次提示）。
   *
   * 历史上这里曾有 `acceptUnknownHostKey` 选项，但当 true 时它等价于 acceptAll，违反 CLAUDE.md
   * "no acceptAll default" 不变量；为安全考量直接移除，宁可让 MCP 客户端在 Phase 4 用不了 SSH。
   */
  keepaliveIntervalMs: z.number().int().nonnegative().optional(),
  readyTimeoutMs: z.number().int().positive().optional(),
  term: z.string().optional(),
  rows: z.number().int().positive().optional(),
  cols: z.number().int().positive().optional(),
  label: z.string().optional(),
});

/** 本地 Shell open 入参。 */
const localShellOpenSchema = z.object({
  type: z.literal('local-shell'),
  shell: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  term: z.string().optional(),
  rows: z.number().int().positive().optional(),
  cols: z.number().int().positive().optional(),
  label: z.string().optional(),
});

/** open_session 入参联合（按 type 判别）。 */
export const openSessionInputSchema = z.object({
  ...commonSchema,
  config: z.discriminatedUnion('type', [serialOpenSchema, sshOpenSchema, localShellOpenSchema]),
});

/** close_session 入参 —— 仅关闭 transport，保留 transcript。 */
export const closeSessionInputSchema = z.object({
  ...commonSchema,
  sessionId: z.string().min(1),
});

/** list_sessions 入参 —— 无业务参数，仅可选 meta 字段。 */
export const listSessionsInputSchema = z.object({
  ...commonSchema,
});

/** write_to_session 入参 —— data 强制 base64/utf-8 二选一。 */
export const writeToSessionInputSchema = z.object({
  ...commonSchema,
  sessionId: z.string().min(1),
  payload: dataPayloadSchema,
});

/** read_from_session 入参 —— cursor 默认 0（最早可见事件）。 */
export const readFromSessionInputSchema = z.object({
  ...commonSchema,
  sessionId: z.string().min(1),
  cursor: z.number().int().nonnegative().default(0),
});

/**
 * 完成标记入参形态。
 *
 * - `string`：字节包含匹配（嵌入式 prompt 通常是 `"# "`、`"OK\r\n"` 等静态片段）。
 * - `{pattern, flags?}`：core 端 `new RegExp(pattern, flags ?? '')` 构造，用于 `\d+>` 等动态 prompt。
 *
 * Phase 7 决策 C13：JSON 入参用对象形态而非直接 RegExp 实例（MCP 协议无法序列化）。
 */
const completionMarkerSchema = z.union([
  z.string().min(1),
  z.object({
    pattern: z.string().min(1),
    // 仅允许标准 RegExp 标志字符，避免 new RegExp 被构造异常 flag 抛错
    flags: z.string().regex(/^[dimsu]*$/).max(8).optional(),
  }),
]);

/**
 * send_and_wait 入参：发送后固定观察窗口，再返回设备输出。
 *
 * 兼容性：`timeoutMs` 保留为 `settleMs` 的废弃别名；completionMarkers
 * 保留用于结果标注，不再阻塞返回。
 */
export const sendAndWaitInputSchema = z.object({
  ...commonSchema,
  sessionId: z.string().min(1),
  payload: dataPayloadSchema,
  /** 发送后的固定观察窗口（毫秒）；缺省使用 TerminalRuleSet 默认值。 */
  settleMs: z.number().int().positive().max(300_000).optional(),
  /** @deprecated 兼容旧客户端；等价于 settleMs，settleMs 优先。 */
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  /** 完成标记列表；只用于结果标注，不是成功前提。 */
  completionMarkers: z.array(completionMarkerSchema).optional(),
  /** 回显处理策略；缺省 'auto'。 */
  echoStrategy: z.enum(['auto', 'keep']).optional(),
  /** 是否在 payload 末尾追加 lineEnding；缺省 true。 */
  appendLineEnding: z.boolean().optional(),
  /** 行尾覆盖；缺省 `\r\n`。 */
  lineEnding: z.string().max(8).optional(),
});

/** discover_serial_ports 入参 —— 无业务参数。 */
export const discoverSerialPortsInputSchema = z.object({
  ...commonSchema,
});

/** get_session_status 入参。 */
export const getSessionStatusInputSchema = z.object({
  ...commonSchema,
  sessionId: z.string().min(1),
});

export type OpenSessionInput = z.infer<typeof openSessionInputSchema>;
export type CloseSessionInput = z.infer<typeof closeSessionInputSchema>;
export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>;
export type WriteToSessionInput = z.infer<typeof writeToSessionInputSchema>;
export type ReadFromSessionInput = z.infer<typeof readFromSessionInputSchema>;
export type SendAndWaitInput = z.infer<typeof sendAndWaitInputSchema>;
export type DiscoverSerialPortsInput = z.infer<typeof discoverSerialPortsInputSchema>;
export type GetSessionStatusInput = z.infer<typeof getSessionStatusInputSchema>;

/**
 * 将 {@link dataPayloadSchema} 解析后的对象解码为 Uint8Array。
 *
 * @param payload 通过 schema 校验的载体
 * @returns 字节序列
 * @throws 当 encoding='base64' 且 data 含非 base64 字符时抛错（避免 Node Buffer 静默丢弃）
 */
export function decodeDataPayload(payload: { encoding: 'utf-8' | 'base64'; data: string }): Uint8Array {
  if (payload.encoding === 'utf-8') {
    return new TextEncoder().encode(payload.data);
  }
  // Node 的 Buffer.from(s, 'base64') 对非法字符宽容（直接丢弃），AI 端写入会变成
  // "成功但字节错"。这里用严格正则预检：A–Z a–z 0–9 + / = 之外一律拒绝。
  // 允许 \r\n/\t/空格作为换行噪声 → 先正常化再校验长度。
  const stripped = payload.data.replace(/[\r\n\t ]/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped) || stripped.length % 4 !== 0) {
    throw new Error('Invalid base64 payload: contains non-base64 characters or wrong padding');
  }
  return new Uint8Array(Buffer.from(stripped, 'base64'));
}
