// @vitest-environment happy-dom
/**
 * render-event 单测：base64 解码 + 行级前缀 + clear/state/error 渲染。
 *
 * Phase 6 评审增量：
 * - H1：跨事件行状态（同 origin 不重复前缀；跨 origin 切换补 \r\n + 前缀）
 * - M1：UTF-8 跨 chunk 流式解码（0xE4 0xB8 → 0xAD 应解出 `中` 而非 U+FFFD）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  renderEventToXterm,
  decodeBase64,
  createRenderState,
  disposeSessionRenderState,
} from '../../../../src/renderer/lib/render-event.js';
import type { SerializedTranscriptEvent } from '../../../../src/shared/transcript-ipc-types.js';

const SID = 'sess_test';

const makeWriteStub = (): { write: ReturnType<typeof vi.fn>; calls: () => string[] } => {
  const fn = vi.fn();
  return {
    write: fn,
    calls: () => fn.mock.calls.map((c) => c[0] as string),
  };
};

const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
};

const b64Bytes = (bytes: number[]): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
};

describe('decodeBase64', () => {
  it('returns empty Uint8Array for empty string', () => {
    expect(decodeBase64('').byteLength).toBe(0);
  });

  it('roundtrips ASCII bytes', () => {
    const decoded = decodeBase64(btoa('hello'));
    const text = new TextDecoder().decode(decoded);
    expect(text).toBe('hello');
  });

  it('handles UTF-8 multi-byte', () => {
    const decoded = decodeBase64(b64('你好'));
    expect(new TextDecoder().decode(decoded)).toBe('你好');
  });
});

describe('renderEventToXterm', () => {
  it('does not render human data in UI to avoid duplicate local echo', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const event: SerializedTranscriptEvent = {
      type: 'data',
      origin: 'human',
      sequence: 1,
      timestamp: Date.now(),
      dataBase64: b64('hello'),
    };
    renderEventToXterm({ write: term.write }, event, state, SID);
    expect(term.calls()).toEqual([]);
  });

  it('renders ai data with purple [A] prefix', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'ai',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('exec'),
      },
      state,
      SID,
    );
    expect(term.calls().join('')).toContain('\x1b[35m[A]');
  });

  it('does NOT prefix device data (raw passthrough)', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('output'),
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toBe('output');
  });

  it('renders clear event as gray separator', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'clear',
        origin: 'human',
        sequence: 5,
        timestamp: Date.UTC(2026, 5, 13, 12, 34, 56),
        meta: { kind: 'clear', precedingCursor: 4 },
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toContain('--- cleared at ');
    expect(out).toContain('\x1b[90m');
  });

  it('renders state event with [state ...]', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'state',
        origin: 'system',
        sequence: 3,
        timestamp: 0,
        meta: { from: 'opening', to: 'open' },
      },
      state,
      SID,
    );
    expect(term.calls().join('')).toContain('[state open');
  });

  it('renders error event in red', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'error',
        origin: 'system',
        sequence: 4,
        timestamp: 0,
        meta: { message: 'boom', source: 'transport', fatal: false },
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('boom');
  });

  it('skips data event when dataBase64 is missing', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'human', sequence: 1, timestamp: 0 },
      state,
      SID,
    );
    expect(term.calls()).toEqual([]);
  });

  it('applies prefix to each line of multi-line chunk', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'ai',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('line1\nline2'),
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    // 两行各自有 [A] 前缀
    const matches = out.match(/\[A\]/g);
    expect(matches?.length).toBe(2);
  });

  // === Phase 6 评审 H1：跨事件行状态 ===

  it('H1: two consecutive non-newline-terminated ai chunks share one [A] prefix', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const evAi = (text: string, seq: number): SerializedTranscriptEvent => ({
      type: 'data',
      origin: 'ai',
      sequence: seq,
      timestamp: 0,
      dataBase64: b64(text),
    });
    renderEventToXterm({ write: term.write }, evAi('foo', 1), state, SID);
    renderEventToXterm({ write: term.write }, evAi('bar', 2), state, SID);
    const out = term.calls().join('');
    const matches = out.match(/\[A\]/g);
    expect(matches?.length).toBe(1);
    expect(out).toContain('foobar');
  });

  it('H1: switching origin mid-line inserts \\r\\n before new prefix', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('raw') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'ai', sequence: 2, timestamp: 0, dataBase64: b64('yo') },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toMatch(/raw\r\n.*\[A\][^\n]*yo/);
  });

  it('H1: chunk ending with \\n returns to line start (next same-origin chunk gets prefix)', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'ai', sequence: 1, timestamp: 0, dataBase64: b64('foo\n') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'ai', sequence: 2, timestamp: 0, dataBase64: b64('bar') },
      state,
      SID,
    );
    const out = term.calls().join('');
    const matches = out.match(/\[A\]/g);
    expect(matches?.length).toBe(2);
  });

  it('keeps device prompt and echo contiguous when human input is hidden', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('msh />') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'human', sequence: 2, timestamp: 0, dataBase64: b64('l') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'human', sequence: 3, timestamp: 0, dataBase64: b64('s') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'human', sequence: 4, timestamp: 0, dataBase64: b64('\r') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 5, timestamp: 0, dataBase64: b64('ls\r\n') },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toBe('msh />ls\r\n');
    expect(out).not.toContain('[H]');
    expect(out).not.toContain('ll');
    expect(out).not.toContain('ss');
  });

  // === Phase 6 评审 M1：UTF-8 跨 chunk 流式解码 ===

  it('M1: streaming TextDecoder reassembles UTF-8 char split across chunks', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    // `中` = 0xE4 0xB8 0xAD；切到 [0xE4, 0xB8] + [0xAD]
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64Bytes([0xe4, 0xb8]),
      },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 2,
        timestamp: 0,
        dataBase64: b64Bytes([0xad]),
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toContain('中');
    expect(out).not.toContain('�');
  });

  it('M1: separate (sessionId, origin) decoders do not corrupt each other', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    // session A 写半个字
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64Bytes([0xe4, 0xb8]),
      },
      state,
      'sess_A',
    );
    // session B 写完整字 `好`
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('好'),
      },
      state,
      'sess_B',
    );
    // session A 补完
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 2,
        timestamp: 0,
        dataBase64: b64Bytes([0xad]),
      },
      state,
      'sess_A',
    );
    const out = term.calls().join('');
    expect(out).toContain('好');
    expect(out).toContain('中');
    expect(out).not.toContain('�');
  });

  it('disposeSessionRenderState clears entries for the session', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'ai', sequence: 1, timestamp: 0, dataBase64: b64('hi') },
      state,
      SID,
    );
    expect(state.lineState.has(SID)).toBe(true);
    expect(state.decoders.size).toBeGreaterThan(0);
    disposeSessionRenderState(state, SID);
    expect(state.lineState.has(SID)).toBe(false);
    expect(state.decoders.size).toBe(0);
  });
});
