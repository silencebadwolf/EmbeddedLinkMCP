/**
 * IPC 跨进程序列化的 TranscriptEvent 类型。
 *
 * 之所以从 `src/main/ipc/session-ipc.ts` 提到 shared：
 * - preload / renderer 端需要消费同一类型来描述 `transcript:event` 推送负载；
 * - 把它放回 `shared/` 可以避免 renderer 反向依赖 main 模块（renderer tsconfig 不引入 src/main）。
 *
 * 注意：本文件**不得引入 Electron 或 Node 运行时依赖**，否则 renderer 编译会拉链 fail。
 *
 * Phase 6 评审 H3：本文件再增 `serializeTranscriptEvent()`，作为 IPC `session:read`/
 * `transcript:event` 与 MCP `read_from_session`/`send_and_wait` 的统一序列化器，
 * 消除两通道 schema 漂移（旧 MCP 输出 `data + dataEncoding`，IPC 输出 `dataBase64`）。
 */

import type { Origin, EvidenceKind } from './types.js';

/** Transcript 事件可能的类型；与 core/transcript/types EventType 镜像（避免反向依赖 core）。 */
export type SerializedTranscriptEventType = 'data' | 'clear' | 'error' | 'state';

/**
 * IPC 序列化版本的 TranscriptEvent。
 *
 * 与 `src/core/transcript/types.ts` 的 `TranscriptEvent` 几乎一致，差异仅在：
 * - `data: Uint8Array` → `dataBase64: string` —— Buffer 跨 worker 复制语义不稳定；
 * - 字段最小化，不含 ITranscriptBuffer 内部状态。
 */
export interface SerializedTranscriptEvent {
  type: SerializedTranscriptEventType;
  origin: Origin;
  sequence: number;
  timestamp: number;
  evidenceKind?: EvidenceKind;
  /** base64 编码；data 字段不存在或为空时省略此键。 */
  dataBase64?: string;
  meta?: Readonly<Record<string, unknown>>;
}

/**
 * `transcript:event` 通道的负载。
 *
 * 当 session 被销毁时，event=null + destroyed=true 作为信号；其余情况 destroyed=false 且 event 必填。
 */
export type TranscriptEventEnvelope =
  | { sessionId: string; event: SerializedTranscriptEvent; destroyed?: false }
  | { sessionId: string; event: null; destroyed: true };

/**
 * `TranscriptEvent.data` 的最小输入面（不依赖 core/transcript/types，避免 renderer 触发反向引用）。
 *
 * 仅声明 byteLength 与可被 base64 编码的可迭代字节序列即可。
 */
export interface RawTranscriptEventInput {
  type: SerializedTranscriptEventType;
  origin: Origin;
  sequence: number;
  timestamp: number;
  evidenceKind?: EvidenceKind;
  data?: Uint8Array;
  meta?: Readonly<Record<string, unknown>>;
}

/**
 * 把 `Uint8Array` 编码为 base64，跨运行时（Node 主进程 / 浏览器渲染端）。
 *
 * 主进程优先走 `Buffer.from().toString('base64')`（无字符串中转，更快）；
 * renderer 没有 `Buffer` 全局，回落到 `btoa` + 字节遍历。
 */
function encodeBase64(bytes: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeBuffer = (globalThis as any).Buffer as
    | { from(b: Uint8Array): { toString(enc: string): string } }
    | undefined;
  if (NodeBuffer) {
    return NodeBuffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).btoa(bin);
}

/**
 * 把 `TranscriptEvent` 序列化为 IPC / MCP 通道安全形态。
 *
 * 关键不变量：
 * - `data: Uint8Array` 一律编码为 `dataBase64: string`（命名与 IPC `session:write` 入参对齐）。
 * - 缺省字段不输出（避免 JSON-RPC payload 显式 `undefined`）。
 *
 * Phase 6 评审 H3 起，IPC `session:read` / `transcript:event` 与 MCP `read_from_session` /
 * `send_and_wait` 的 evidence 都通过本函数产出，schema 单一来源。
 *
 * @param event TranscriptBuffer 内的原始事件
 * @returns IPC / MCP 安全的 JSON 形态
 */
export function serializeTranscriptEvent(event: RawTranscriptEventInput): SerializedTranscriptEvent {
  const out: SerializedTranscriptEvent = {
    type: event.type,
    origin: event.origin,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };
  if (event.evidenceKind) out.evidenceKind = event.evidenceKind;
  if (event.data && event.data.byteLength > 0) {
    out.dataBase64 = encodeBase64(event.data);
  }
  if (event.meta) out.meta = event.meta;
  return out;
}
