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
} from '@linkterm/ui/lib/render-event';
import type { SerializedTranscriptEvent } from '../../../../src/shared/transcript-ipc-types.js';

const SID = 'sess_test';

const makeWriteStub = (): { write: ReturnType<typeof vi.fn>; calls: () => string[] } => {
  const fn = vi.fn();
  return {
    write: fn,
    calls: () => fn.mock.calls.map((c) => c[0] as string),
  };
};

const makeDeferredWriteStub = (): {
  write: ReturnType<typeof vi.fn>;
  flush: () => void;
  calls: () => string[];
} => {
  const callbacks: Array<() => void> = [];
  const fn = vi.fn((data: string, callback?: () => void) => {
    if (callback) callbacks.push(callback);
  });
  return {
    write: fn,
    flush: () => {
      for (const callback of callbacks.splice(0)) callback();
    },
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
  it('renders serial human data locally without an origin label', () => {
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
    expect(term.calls().join('')).toBe('hello');
  });

  it('renders human data locally for RTT log sessions', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const event: SerializedTranscriptEvent = {
      type: 'data',
      origin: 'human',
      sequence: 1,
      timestamp: Date.now(),
      dataBase64: b64('help\r\n'),
    };
    renderEventToXterm({ write: term.write }, event, state, SID, {
      connectionType: 'rtt-log',
    });
    expect(term.calls().join('')).toBe('help\r\n');
  });

  it('renders serial AI data locally without an origin label', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'ai',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('help\r\n'),
      },
      state,
      SID,
    );
    expect(term.calls().join('')).toBe('help\r\n');
  });

  it('removes a matching device echo but keeps the device response', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'human', sequence: 1, timestamp: 0, dataBase64: b64('ps\r') },
      state,
      SID,
      { connectionType: 'serial' },
    );
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 2,
        timestamp: 0,
        dataBase64: b64('ps\r\nCPU 1\r\nmsh >'),
      },
      state,
      SID,
      { connectionType: 'serial' },
    );
    expect(term.calls().join('')).toContain('ps\r\nCPU 1');
    expect(term.calls().join('')).toContain('msh >');
  });

  it('renders ai data locally for RTT log sessions', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'ai',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('version\r\n'),
      },
      state,
      SID,
      { connectionType: 'rtt-log' },
    );
    expect(term.calls().join('')).toBe('version\r\n');
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

  it('reports visible-device ack only after xterm write completion callback fires', async () => {
    const term = makeDeferredWriteStub();
    const state = createRenderState();
    const result = renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 7,
        timestamp: 0,
        dataBase64: b64('boot ok'),
      },
      state,
      SID,
    );
    const visible: number[] = [];
    void result.completion.then((ack) => {
      if (ack.visibleDeviceSequence !== undefined) visible.push(ack.visibleDeviceSequence);
    });

    await Promise.resolve();
    expect(result.wroteDeviceText).toBe(true);
    expect(visible).toEqual([]);

    term.flush();
    await Promise.resolve();
    expect(visible).toEqual([7]);
  });

  it('does not treat synchronous term.write return as visible-device ack', async () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const result = renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 8,
        timestamp: 0,
        dataBase64: b64('boot ok'),
      },
      state,
      SID,
    );
    const visible: number[] = [];
    void result.completion.then((ack) => {
      if (ack.visibleDeviceSequence !== undefined) visible.push(ack.visibleDeviceSequence);
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(term.calls()).toEqual(['boot ok']);
    expect(visible).toEqual([]);
  });

  it('does not create visible-device ack for state, error, clear, outgoing, empty, or incomplete UTF-8 events', async () => {
    const term = makeDeferredWriteStub();
    const state = createRenderState();
    const events: SerializedTranscriptEvent[] = [
      { type: 'state', origin: 'system', sequence: 1, timestamp: 0, meta: { to: 'open' } },
      { type: 'error', origin: 'system', sequence: 2, timestamp: 0, meta: { message: 'boom' } },
      { type: 'clear', origin: 'human', sequence: 3, timestamp: 0 },
      { type: 'data', origin: 'human', sequence: 4, timestamp: 0, dataBase64: b64('cmd') },
      { type: 'data', origin: 'device', sequence: 5, timestamp: 0, dataBase64: '' },
      { type: 'data', origin: 'device', sequence: 6, timestamp: 0, dataBase64: b64Bytes([0xe4, 0xb8]) },
    ];
    const results = events.map((event) =>
      renderEventToXterm({ write: term.write }, event, state, SID),
    );
    term.flush();
    const acks = await Promise.all(results.map((result) => result.completion));
    expect(acks.map((ack) => ack.visibleDeviceSequence)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('resets unterminated ANSI color at line breaks for embedded terminal output', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('\x1b[32m[I/main] ready\nmsh >'),
      },
      state,
      SID,
      { connectionType: 'serial' },
    );
    const out = term.calls().join('');
    expect(out).toBe('\x1b[32m[I/main] ready\x1b[0m\nmsh >');
  });

  it('keeps SSH device ANSI streams unchanged', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('\x1b[32mremote\nprompt'),
      },
      state,
      SID,
      { connectionType: 'ssh' },
    );
    const out = term.calls().join('');
    expect(out).toBe('\x1b[32mremote\nprompt');
  });

  it('preserves an embedded shell prompt when device output omits the final line break', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('\x1b[32mlna=DISABLED softwarert_statusmsh >'),
      },
      state,
      SID,
      { connectionType: 'serial' },
    );
    const out = term.calls().join('');
    expect(out).toBe('\x1b[32mlna=DISABLED softwarert_statusmsh >');
  });

  it('renders split shell prompt chunks without buffering or rewriting', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const chunks = ['ui=SKIP\0m', 'sh', ' >'];
    chunks.forEach((chunk, index) => {
      renderEventToXterm(
        { write: term.write },
        {
          type: 'data',
          origin: 'device',
          sequence: index + 1,
          timestamp: 0,
          dataBase64: b64(chunk),
        },
        state,
        SID,
        { connectionType: 'serial' },
      );
    });

    expect(term.calls()).toEqual(chunks);
    expect(term.calls().join('')).toBe('ui=SKIP\0msh >');
  });

  it('preserves device logs emitted directly after a prompt chunk', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('msh >') },
      state,
      SID,
      { connectionType: 'serial' },
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 2, timestamp: 0, dataBase64: b64('[I/fna] ready') },
      state,
      SID,
      { connectionType: 'serial' },
    );

    expect(term.calls().join('')).toBe('msh >[I/fna] ready');
  });

  it('preserves duplicate device prompts separated by a line break', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('\r\nmsh >\r\nmsh >') },
      state,
      SID,
      { connectionType: 'serial' },
    );

    expect(term.calls().join('')).toBe('\x1b[0m\r\nmsh >\x1b[0m\r\nmsh >');
  });

  it('preserves a duplicate prompt that arrives in a later device chunk', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const options = { connectionType: 'serial' as const };
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('msh >\r\n') },
      state,
      SID,
      options,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 2, timestamp: 0, dataBase64: b64('msh >') },
      state,
      SID,
      options,
    );

    expect(term.calls().join('')).toBe('msh >\x1b[0m\r\nmsh >');
  });

  it('renders an ordinary device suffix without prompt-prefix buffering', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('alarm') },
      state,
      SID,
      { connectionType: 'serial' },
    );
    expect(term.calls().join('')).toBe('alarm');
  });

  it('renders an ordinary suffix before a following control event', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('alarm') },
      state,
      SID,
      { connectionType: 'serial' },
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'error', origin: 'system', sequence: 2, timestamp: 0, meta: { message: 'offline' } },
      state,
      SID,
      { connectionType: 'serial' },
    );

    const out = term.calls().join('');
    expect(out.indexOf('alarm')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('alarm')).toBeLessThan(out.indexOf('[error] offline'));
  });

  it('keeps SSH prompt-like text unchanged when it arrives mid-line', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'device',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('remote outputmsh >'),
      },
      state,
      SID,
      { connectionType: 'ssh' },
    );
    const out = term.calls().join('');
    expect(out).toBe('remote outputmsh >');
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

  it('applies system prefix to each line of multi-line chunk', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      {
        type: 'data',
        origin: 'system',
        sequence: 1,
        timestamp: 0,
        dataBase64: b64('line1\nline2'),
      },
      state,
      SID,
    );
    const out = term.calls().join('');
    const matches = out.match(/\[S\]/g);
    expect(matches?.length).toBe(2);
  });

  // === Phase 6 评审 H1：跨事件行状态 ===

  it('H1: two consecutive non-newline-terminated system chunks share one [S] prefix', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    const evSystem = (text: string, seq: number): SerializedTranscriptEvent => ({
      type: 'data',
      origin: 'system',
      sequence: seq,
      timestamp: 0,
      dataBase64: b64(text),
    });
    renderEventToXterm({ write: term.write }, evSystem('foo', 1), state, SID);
    renderEventToXterm({ write: term.write }, evSystem('bar', 2), state, SID);
    const out = term.calls().join('');
    const matches = out.match(/\[S\]/g);
    expect(matches?.length).toBe(1);
    expect(out).toContain('foobar');
  });

  it('H1: switching origin mid-line inserts \r\n before system prefix', () => {
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
      { type: 'data', origin: 'system', sequence: 2, timestamp: 0, dataBase64: b64('yo') },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toMatch(/raw\r\n.*\[S\][^\n]*yo/);
  });

  it('H1: system chunk ending with \n returns to line start (next same-origin chunk gets prefix)', () => {
    const term = makeWriteStub();
    const state = createRenderState();
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'system', sequence: 1, timestamp: 0, dataBase64: b64('foo\n') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'system', sequence: 2, timestamp: 0, dataBase64: b64('bar') },
      state,
      SID,
    );
    const out = term.calls().join('');
    const matches = out.match(/\[S\]/g);
    expect(matches?.length).toBe(2);
  });

  it('shows human input separately from a device echo', () => {
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
  });

  it('shows AI input through the device echo without duplicating the command', () => {
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
      { type: 'data', origin: 'ai', sequence: 2, timestamp: 0, dataBase64: b64('help\r\n') },
      state,
      SID,
    );
    renderEventToXterm(
      { write: term.write },
      { type: 'data', origin: 'device', sequence: 3, timestamp: 0, dataBase64: b64('help\r\nRT-Thread shell commands:\r\nmsh />') },
      state,
      SID,
    );
    const out = term.calls().join('');
    expect(out).toBe('msh />help\r\nRT-Thread shell commands:\r\nmsh />');
    expect(out.match(/help/g)?.length).toBe(1);
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
      { type: 'data', origin: 'device', sequence: 1, timestamp: 0, dataBase64: b64('hi') },
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
