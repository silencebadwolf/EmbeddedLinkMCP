/**
 * 把 IPC 序列化的 TranscriptEvent 渲染到 xterm.js Terminal。
 *
 * **单一收敛点**：base64 → bytes → UTF-8 解码、行级 origin 前缀、ANSI 颜色、clear 分隔符
 * 所有逻辑只在本文件实现；TerminalView 仅负责调度。
 *
 * Origin 颜色映射（行首前缀）：
 * - S（System）→ 灰色 `\x1b[90m`
 * - D（Device）→ 默认色，不加前缀（保留终端原貌，避免 device chunk 频繁换行污染）
 * - Human/AI data → 不渲染到 UI（写入仍进 transcript 供 MCP 取证；UI 等待设备/PTY 回显，避免本地重复回显）
 *
 * Phase 6 评审 H1：行级前缀依赖跨事件的“行首/行内”状态。两次带前缀 origin（如 system）的不带 `\n`
 * 数据本来不应再注入第二次前缀；而 origin 跨切换时（Device→System）需要先补 `\r\n` 再插入前缀。
 * 这要求渲染器持有一份 per-session 的行状态 —— 由调用方（hook）维护并传入。
 *
 * Phase 6 评审 M1：UTF-8 多字节字符可能跨 chunk 边界（例如 `中`=0xE4 0xB8 0xAD 三字节，
 * 串口 chunk 切到 0xE4 0xB8 + 0xAD），单例 TextDecoder 在跨 chunk 调用时不带 `stream:true`
 * 会把不完整序列替换成 U+FFFD。改用按 (sessionId, origin) 的 decoder 池 + `stream:true`。
 */

import type { Origin } from '../../shared/types.js';
import type { SessionId } from '../../shared/types.js';
import type { SerializedTranscriptEvent } from '../../shared/transcript-ipc-types.js';

/** xterm-side 期望的最小 Terminal 接口；用本接口而非全 Terminal 类便于测试 stub。 */
export interface XtermLike {
  write(data: string): void;
}

/**
 * 单 session 的行状态。
 *
 * - `lastOrigin`：最近一次往该 session 屏幕写入的 origin（含 device）。
 * - `atLineStart`：最近一次写入是否以 `\n` 结尾（或尚无任何写入）。
 *   仅当处于行首时才会注入下一行的 origin 前缀；否则继续写在原行末尾。
 *
 * 跨 origin 切换且非行首时，渲染器会先补 `\r\n` 再写新 origin 的前缀，避免类似
 * `abc[H]def` 这样的视觉混淆。
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
}

/**
 * 创建一个空的渲染状态容器；hook 在 mount 时调用一次。
 */
export function createRenderState(): RenderState {
  return {
    lineState: new Map(),
    decoders: new Map(),
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

/** 行首前缀颜色映射；device/outgoing data 不加前缀。 */
const ORIGIN_PREFIX: Readonly<Record<string, string>> = {
  system: '\x1b[90m[S]\x1b[0m ',
};

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
): void {
  switch (event.type) {
    case 'data': {
      if (!event.dataBase64) return;
      if (event.origin === 'human' || event.origin === 'ai') {
        // UI 不本地回显 outgoing 输入；等待设备/PTY 自己 echo，避免串口终端出现 [A] 与重复命令。
        return;
      }
      const bytes = decodeBase64(event.dataBase64);
      // 流式解码：跨 chunk 的多字节字符不会被 U+FFFD 替换
      const decoder = getDecoder(state, sessionId, event.origin);
      const text = decoder.decode(bytes, { stream: true });
      if (text.length === 0) return;
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
      if (preamble || applied.out) {
        term.write(preamble + applied.out);
      }
      ls.atLineStart = applied.atLineStart;
      ls.lastOrigin = event.origin;
      return;
    }
    case 'clear': {
      // req §4.5：clear 不能丢历史；UI 渲染为分隔符让 AI 与人都能看到边界
      term.write(`\r\n\x1b[90m--- cleared at ${formatTime(event.timestamp)} ---\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return;
    }
    case 'state': {
      const meta = event.meta as { from?: string; to?: string } | undefined;
      const desc = meta?.to ?? '?';
      term.write(`\r\n\x1b[90m[state ${desc} @ ${formatTime(event.timestamp)}]\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return;
    }
    case 'error': {
      const meta = event.meta as { message?: string } | undefined;
      const msg = meta?.message ?? 'error';
      term.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`);
      const ls = getLineState(state, sessionId);
      ls.atLineStart = true;
      ls.lastOrigin = event.origin;
      return;
    }
    default:
      // 兜底：未知类型不渲染（保持 xterm 状态稳定）
      return;
  }
}
