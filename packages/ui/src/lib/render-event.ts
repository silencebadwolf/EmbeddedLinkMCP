/**
 * 把 IPC 序列化的 TranscriptEvent 渲染到 xterm.js Terminal。
 *
 * **单一收敛点**：base64 → bytes → UTF-8 解码、行级 origin 前缀、ANSI 颜色、clear 分隔符
 * 所有逻辑只在本文件实现；TerminalView 仅负责调度。
 *
 * Origin 颜色映射（行首前缀）：
 * - S（System）→ 灰色 `\x1b[90m`
 * - D（Device）→ 默认色，不加前缀（保留终端原貌，避免 device chunk 频繁换行污染）
 * - Human/AI data → 终端无标签本地回显；设备/PTY 随后回显同一字节时在渲染前去重
 *
 * Phase 6 评审 H1：行级前缀依赖跨事件的“行首/行内”状态。两次带前缀 origin（如 system）的不带 `\n`
 * 数据本来不应再注入第二次前缀；而 origin 跨切换时（Device→System）需要先补 `\r\n` 再插入前缀。
 * 这要求渲染器持有一份 per-session 的行状态 —— 由调用方（hook）维护并传入。
 *
 * Phase 6 评审 M1：UTF-8 多字节字符可能跨 chunk 边界（例如 `中`=0xE4 0xB8 0xAD 三字节，
 * 串口 chunk 切到 0xE4 0xB8 + 0xAD），单例 TextDecoder 在跨 chunk 调用时不带 `stream:true`
 * 会把不完整序列替换成 U+FFFD。改用按 (sessionId, origin) 的 decoder 池 + `stream:true`。
 */

import type { ConnectionType, Origin } from '@linkterm/contracts/types';
import type { SessionId } from '@linkterm/contracts/types';
import type { SerializedTranscriptEvent } from '@linkterm/contracts/transcript-ipc-types';

/** xterm-side 期望的最小 Terminal 接口；用本接口而非全 Terminal 类便于测试 stub。 */
export interface XtermLike {
  write(data: string, callback?: () => void): void;
}

export interface RenderEventOptions {
  connectionType?: ConnectionType;
}

export interface RenderEventCompletionAck {
  readonly visibleDeviceSequence?: number;
}

export interface RenderEventResult {
  readonly wroteDeviceText: boolean;
  readonly completion: Promise<RenderEventCompletionAck>;
}

const NO_VISIBLE_DEVICE_ACK: RenderEventResult = {
  wroteDeviceText: false,
  completion: Promise.resolve({}),
};

/**
 * 单 session 的行状态。
 *
 * - `lastOrigin`：最近一次往该 session 屏幕写入的 origin（含 device）。
 * - `atLineStart`：最近一次写入是否以 `\n` 结尾（或尚无任何写入）。
 *   仅当处于行首时才会注入下一行的 origin 前缀；否则继续写在原行末尾。
 *
 * 跨 origin 切换且非行首时，渲染器会先补 `\r\n` 再写新 origin 的前缀，避免类似
 * 系统消息粘在设备输出末尾的视觉混淆。
 */
interface SessionLineState {
  lastOrigin: Origin | null;
  atLineStart: boolean;
}

/**
 * 渲染状态容器：跨事件持有的行状态 + UTF-8 流式解码器池。
 *
 * 由 `useTranscript` 等调用方在 hook 闭包内通过 `createRenderState()` 创建，
 * 保证多个 useTranscript 实例（多终端共存）状态相互隔离。
 *
 * **不变量**：状态更新仅发生在 `renderEventToXterm` 内部；调用方不应直接读写 Map。
 */
export interface RenderState {
  /** Map key：sessionId。 */
  readonly lineState: Map<SessionId, SessionLineState>;
  /** Map key：`${sessionId}\0${origin}`；UTF-8 流式 decoder，跨事件保留半个字符的尾巴。 */
  readonly decoders: Map<string, TextDecoder>;
  /** 尚未被设备/PTY 回显消费的出站字节。 */
  readonly pendingEcho: Map<SessionId, PendingEcho[]>;
}

interface PendingEcho {
  bytes: Uint8Array;
  createdAt: number;
}

const OUTGOING_ECHO_TTL_MS = 1_500;

/**
 * 创建一个空的渲染状态容器；hook 在 mount 时调用一次。
 */
export function createRenderState(): RenderState {
  return {
    lineState: new Map(),
    decoders: new Map(),
    pendingEcho: new Map(),
  };
}

/**
 * 清理某 session 的渲染状态（行状态 + 所有 origin 的 decoder）。
 *
 * 调用时机：session 被 destroyed envelope 通知销毁，或 hook unmount 时。
 *
 * @param state 渲染状态容器
 * @param sessionId 目标 session
 */
export function disposeSessionRenderState(state: RenderState, sessionId: SessionId): void {
  state.lineState.delete(sessionId);
  // decoder map 用 `${sessionId}\0${origin}` 作 key；按前缀匹配清理
  const prefix = `${sessionId}\0`;
  for (const key of state.decoders.keys()) {
    if (key.startsWith(prefix)) state.decoders.delete(key);
  }
  state.pendingEcho.delete(sessionId);
}

function enqueuePendingEcho(state: RenderState, sessionId: SessionId, bytes: Uint8Array): void {
  if (bytes.byteLength === 0) return;
  // RT-Thread/PTY 通常 echoes Enter as CRLF even when the wire input is a bare CR.
  // Include the visual LF in the matcher so local and remote Enter do not double-space.
  const expected = bytes[bytes.byteLength - 1] === 0x0d
    ? Uint8Array.from([...bytes, 0x0a])
    : bytes;
  const queue = state.pendingEcho.get(sessionId) ?? [];
  queue.push({ bytes: expected.slice(), createdAt: Date.now() });
  state.pendingEcho.set(sessionId, queue);
}

/** 从设备数据开头消费已经本地显示过的出站字节。 */
function consumePendingEcho(
  state: RenderState,
  sessionId: SessionId,
  bytes: Uint8Array,
): Uint8Array {
  const queue = state.pendingEcho.get(sessionId);
  if (!queue || queue.length === 0) return bytes;
  const now = Date.now();
  while (queue.length > 0 && now - queue[0]!.createdAt > OUTGOING_ECHO_TTL_MS) queue.shift();
  if (queue.length === 0) {
    state.pendingEcho.delete(sessionId);
    return bytes;
  }

  let offset = 0;
  while (offset < bytes.byteLength && queue.length > 0) {
    const pending = queue[0]!;
    const available = bytes.byteLength - offset;
    const compareLength = Math.min(available, pending.bytes.byteLength);
    let matched = 0;
    while (matched < compareLength && bytes[offset + matched] === pending.bytes[matched]) matched += 1;
    if (matched === 0) break;
    if (matched < pending.bytes.byteLength && matched < available) break;
    offset += matched;
    if (matched === pending.bytes.byteLength) {
      queue.shift();
    } else {
      pending.bytes = pending.bytes.slice(matched);
      break;
    }
  }
  if (queue.length === 0) state.pendingEcho.delete(sessionId);
  return offset === 0 ? bytes : bytes.slice(offset);
}

function renderOutgoingText(text: string, connectionType: ConnectionType | undefined): string {
  if (connectionType === 'rtt-log') return text;
  // xterm does not turn a bare CR into a visual newline. Keep the wire byte unchanged
  // in transcript, but make a silent serial/PTY usable as a normal terminal on screen.
  return text.replace(/\r(?!\n)/gu, '\r\n');
}

/**
 * 浏览器原生 base64 → Uint8Array。
 *
 * renderer 不能用 `Buffer`（contextIsolation 下没有 Node 全局），改用 `atob` + 手工拼数组。
 *
 * @param base64 base64 字符串；空串返回 0 字节数组
 * @returns 字节数组
 */
export function decodeBase64(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** 行首前缀颜色映射；人类/AI 来源只保留在 transcript/audit，不在终端画面添加标签。 */
const ORIGIN_PREFIX: Readonly<Record<string, string>> = {
  system: '\x1b[90m[S]\x1b[0m ',
};

const ANSI_RESET = '\x1b[0m';

/** 把 HH:MM:SS 格式时间戳转字符串。 */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * 取或建一个 (sessionId, origin) 维度的 UTF-8 流式 decoder。
 *
 * 用 `stream:true` 调用 `decode()` 时，decoder 会把不完整的多字节序列保留在内部 state，
 * 等待下一次 chunk —— 这是跨 chunk UTF-8 的唯一正确解码姿势。
 */
function getDecoder(state: RenderState, sessionId: SessionId, origin: Origin): TextDecoder {
  const key = `${sessionId}\0${origin}`;
  let dec = state.decoders.get(key);
  if (!dec) {
    dec = new TextDecoder('utf-8', { fatal: false });
    state.decoders.set(key, dec);
  }
  return dec;
}

/**
 * 取或建一个 sessionId 维度的行状态。
 *
 * 默认初始化为 `atLineStart=true`（首次写入应当带 origin 前缀）。
 */
function getLineState(state: RenderState, sessionId: SessionId): SessionLineState {
  let ls = state.lineState.get(sessionId);
  if (!ls) {
    ls = { lastOrigin: null, atLineStart: true };
    state.lineState.set(sessionId, ls);
  }
  return ls;
}

/**
 * 根据当前行状态把 chunk 拆成"前缀 + 该行内容"，并产出新行状态。
 *
 * 算法：
 * 1. 若 chunk 内不含 `\n`：
 *    - 行首：返回 `prefix + chunk`，atLineStart=false；
 *    - 行内：返回 `chunk`，atLineStart 保持 false。
 * 2. 若 chunk 内含 `\n`：以 `\n` 切分，逐行注入前缀；末尾段单独处理：
 *    - 若末尾段为空（chunk 以 `\n` 结尾）：atLineStart=true，无悬挂前缀；
 *    - 若末尾段非空：注入前缀，atLineStart=false。
 * 3. 空字符串 chunk：原样返回，状态不变。
 *
 * @returns 已拼好的 xterm 写入字符串 + 是否处于行首
 */
function applyLineStatePrefix(
  chunk: string,
  prefix: string,
  atLineStart: boolean,
): { out: string; atLineStart: boolean } {
  if (chunk.length === 0) return { out: '', atLineStart };
  if (!prefix) {
    // device origin：原样写入，但仍要更新 atLineStart 以便 origin 切换时正确补 \r\n
    return { out: chunk, atLineStart: chunk.endsWith('\n') };
  }
  // 拆行：以 `\n` 切分（保留分隔符语义），首段是否需要前缀取决于 atLineStart
  const parts = chunk.split('\n');
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const isFirst = i === 0;
    const isLast = i === parts.length - 1;
    const segment = parts[i] ?? '';
    if (isLast && segment.length === 0) {
      // 最后一段是空（chunk 以 \n 结尾）：不再注入前缀，下次写入会处于行首
      continue;
    }
    if (isFirst) {
      result.push(atLineStart ? prefix + segment : segment);
    } else {
      result.push(prefix + segment);
    }
  }
  // 用 \n 连接（xterm 在 PTY/原始模式下会把 \n 解释为换行；不强行写 \r\n 以保留底层语义）
  const out = result.join('\n') + (chunk.endsWith('\n') ? '\n' : '');
  return { out, atLineStart: chunk.endsWith('\n') };
}

function shouldResetAnsiAtEmbeddedLineBreaks(
  origin: Origin,
  connectionType: ConnectionType | undefined,
): boolean {
  return origin === 'device' && (connectionType === 'serial' || connectionType === 'rtt-log');
}

function resetAnsiAtLineBreaks(text: string): string {
  return text.replace(/(\x1b\[0m)?(\r\n|\n|\r)/gu, (_match, reset: string | undefined, lineBreak: string) =>
    `${reset ?? ANSI_RESET}${lineBreak}`,
  );
}

/**
 * 把单条 transcript 事件渲染到 Terminal。
 *
 * @param term 目标 Terminal（或最小 XtermLike stub）
 * @param event 已序列化的 transcript 事件
 * @param state 跨事件渲染状态（行状态 + decoder 池）；同一 session 必须复用同一份 state
 * @param sessionId 事件所属 session id（来自 envelope.sessionId）
 */
export function renderEventToXterm(
  term: XtermLike,
  event: SerializedTranscriptEvent,
  state: RenderState,
  sessionId: SessionId,
  options: RenderEventOptions = {},
): RenderEventResult {
  switch (event.type) {
    case 'data': {
      if (!event.dataBase64) return NO_VISIBLE_DEVICE_ACK;
      const bytes = decodeBase64(event.dataBase64);
      if (event.origin === 'human' || event.origin === 'ai') {
        enqueuePendingEcho(state, sessionId, bytes);
        const decoder = getDecoder(state, sessionId, event.origin);
        const text = renderOutgoingText(
          decoder.decode(bytes, { stream: true }),
          options.connectionType,
        );
        if (text.length === 0) return NO_VISIBLE_DEVICE_ACK;
        term.write(text);
        const ls = getLineState(state, sessionId);
        ls.atLineStart = text.endsWith('\n');
        ls.lastOrigin = event.origin;
        return NO_VISIBLE_DEVICE_ACK;
      }
      const visibleBytes = consumePendingEcho(state, sessionId, bytes);
      if (visibleBytes.byteLength === 0) return NO_VISIBLE_DEVICE_ACK;
      // 流式解码：跨 chunk 的多字节字符不会被 U+FFFD 替换
      const decoder = getDecoder(state, sessionId, event.origin);
      const decodedText = decoder.decode(visibleBytes, { stream: true });
      const text = shouldResetAnsiAtEmbeddedLineBreaks(event.origin, options.connectionType)
        ? resetAnsiAtLineBreaks(decodedText)
        : decodedText;
      if (text.length === 0) return NO_VISIBLE_DEVICE_ACK;
      const ls = getLineState(state, sessionId);
      const prefix = ORIGIN_PREFIX[event.origin] ?? '';
      // 跨 origin 切换且非行首：先补 \r\n 让前缀落到新行起点
      let preamble = '';
      let atLineStart = ls.atLineStart;
      if (
        prefix &&
        !atLineStart &&
        ls.lastOrigin !== null &&
        ls.lastOrigin !== event.origin
      ) {
        preamble = '\r\n';
        atLineStart = true;
      }
      const applied = applyLineStatePrefix(text, prefix, atLineStart);
      const output = preamble + applied.out;
      let completion = NO_VISIBLE_DEVICE_ACK.completion;
      const wroteDeviceText = event.origin === 'device' && output.length > 0;
      if (output) {
        if (wroteDeviceText) {
          completion = new Promise<RenderEventCompletionAck>((resolve) => {
            term.write(output, () => {
              resolve({ visibleDeviceSequence: event.sequence });
            });
          });
        } else {
          term.write(output);
        }
      }
      ls.atLineStart = applied.atLineStart;
      ls.lastOrigin = event.origin;
      return { wroteDeviceText, completion };
    }
    case 'clear': {
      // req §4.5：clear 不能丢历史；UI 渲染为分隔符让 AI 与人都能看到边界
      term.write(`\r\n\x1b[90m--- cleared at ${formatTime(event.timestamp)} ---\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return NO_VISIBLE_DEVICE_ACK;
    }
    case 'state': {
      const meta = event.meta as { from?: string; to?: string } | undefined;
      const desc = meta?.to ?? '?';
      term.write(`\r\n\x1b[90m[state ${desc} @ ${formatTime(event.timestamp)}]\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return NO_VISIBLE_DEVICE_ACK;
    }
    case 'error': {
      const meta = event.meta as { message?: string } | undefined;
      const msg = meta?.message ?? 'error';
      term.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return NO_VISIBLE_DEVICE_ACK;
    }
    default:
      // 兜底：未知类型不渲染（保持 xterm 状态稳定）
      return NO_VISIBLE_DEVICE_ACK;
  }
}
