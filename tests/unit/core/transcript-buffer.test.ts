import { describe, expect, it } from 'vitest';
import { TranscriptBuffer } from '@/core/transcript/transcript-buffer.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('TranscriptBuffer', () => {
  it('appends events with monotonically increasing sequence', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    const a = buf.append({ type: 'data', origin: 'human', data: utf8('a') });
    const b = buf.append({ type: 'data', origin: 'ai', data: utf8('b') });
    const c = buf.append({ type: 'clear', origin: 'human' });
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
    expect(c.sequence).toBe(3);
    expect(buf.size()).toBe(3);
    expect(buf.latestCursor()).toBe(3);
    expect(buf.earliestCursor()).toBe(1);
  });

  it('readSince(0) returns all events from earliest', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    buf.append({ type: 'data', origin: 'human', data: utf8('a') });
    buf.append({ type: 'data', origin: 'human', data: utf8('b') });
    const result = buf.readSince(0);
    expect(result.events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(result.cursor).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('readSince(cursor) returns only events after cursor', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    buf.append({ type: 'data', origin: 'human', data: utf8('a') });
    const second = buf.append({ type: 'data', origin: 'human', data: utf8('b') });
    buf.append({ type: 'data', origin: 'human', data: utf8('c') });
    const result = buf.readSince(second.sequence);
    expect(result.events.map((e) => e.sequence)).toEqual([3]);
    expect(result.cursor).toBe(3);
  });

  it('readSince(latest) returns no events with cursor unchanged', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    buf.append({ type: 'data', origin: 'human', data: utf8('a') });
    const result = buf.readSince(1);
    expect(result.events).toEqual([]);
    expect(result.cursor).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('returns empty result on empty buffer', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    const result = buf.readSince(0);
    expect(result.events).toEqual([]);
    expect(result.cursor).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('records clear as a transcript event without removing history', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    buf.append({ type: 'data', origin: 'human', data: utf8('a') });
    buf.append({ type: 'clear', origin: 'human' });
    buf.append({ type: 'data', origin: 'device', data: utf8('b') });
    const result = buf.readSince(0);
    expect(result.events.map((e) => e.type)).toEqual(['data', 'clear', 'data']);
    expect(result.events[0]?.data).toEqual(utf8('a'));
  });

  it('drops oldest events when capacity is exceeded and reports truncated', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1', capacity: 3 });
    for (let i = 0; i < 5; i += 1) {
      buf.append({ type: 'data', origin: 'human', data: utf8(String(i)) });
    }
    expect(buf.size()).toBe(3);
    expect(buf.earliestCursor()).toBe(3); // 1,2 已被丢弃
    expect(buf.latestCursor()).toBe(5);

    const result = buf.readSince(1);
    expect(result.truncated).toBe(true);
    expect(result.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
  });

  it('does not flag truncated when cursor is within retained range', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1', capacity: 3 });
    for (let i = 0; i < 5; i += 1) {
      buf.append({ type: 'data', origin: 'human', data: utf8(String(i)) });
    }
    // earliest=3，cursor=3 不算 truncated（cursor 表示"已读到 3"，下次从 4 开始正好衔接）
    const result = buf.readSince(3);
    expect(result.truncated).toBe(false);
    expect(result.events.map((e) => e.sequence)).toEqual([4, 5]);
  });

  it('supports multiple independent cursors reading from different positions', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    for (let i = 0; i < 10; i += 1) {
      buf.append({ type: 'data', origin: 'human', data: utf8(String(i)) });
    }
    const reader1 = buf.readSince(0);
    const reader2 = buf.readSince(5);
    expect(reader1.events.length).toBe(10);
    expect(reader2.events.length).toBe(5);
    expect(reader2.events[0]?.sequence).toBe(6);
  });

  it('rejects invalid capacity', () => {
    expect(() => new TranscriptBuffer({ sessionId: 's1', capacity: 0 })).toThrow();
    expect(() => new TranscriptBuffer({ sessionId: 's1', capacity: -1 })).toThrow();
    expect(() => new TranscriptBuffer({ sessionId: 's1', capacity: 1.5 })).toThrow();
  });

  it('rejects invalid cursor', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    expect(() => buf.readSince(-1)).toThrow();
    expect(() => buf.readSince(Number.NaN)).toThrow();
  });

  it('handles a large number of independent cursors without leaking state', () => {
    const buf = new TranscriptBuffer({ sessionId: 's1' });
    for (let i = 0; i < 20; i += 1) {
      buf.append({ type: 'data', origin: 'human', data: utf8(String(i)) });
    }
    const cursors = Array.from({ length: 10 }, (_, i) => i * 2);
    const results = cursors.map((c) => buf.readSince(c));
    results.forEach((r, i) => {
      expect(r.events[0]?.sequence).toBe(cursors[i]! + 1);
    });
  });

  describe('clear cursor boundary', () => {
    it('auto-fills clear meta with kind:"clear" and precedingCursor', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      buf.append({ type: 'data', origin: 'device', data: utf8('b') });
      const clearEvent = buf.append({ type: 'clear', origin: 'human' });
      expect(clearEvent.meta).toMatchObject({ kind: 'clear', precedingCursor: 2 });
    });

    it('clear precedingCursor is 0 when buffer was empty', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      const clearEvent = buf.append({ type: 'clear', origin: 'ai' });
      expect(clearEvent.meta).toMatchObject({ kind: 'clear', precedingCursor: 0 });
    });

    it('preserves caller-provided meta keys around the auto-filled clear meta', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      const clearEvent = buf.append({
        type: 'clear',
        origin: 'human',
        meta: { reason: 'user-pressed-ctrl-l' },
      });
      expect(clearEvent.meta).toMatchObject({
        kind: 'clear',
        precedingCursor: 1,
        reason: 'user-pressed-ctrl-l',
      });
    });

    it('overrides caller-provided kind/precedingCursor on clear events', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      const clearEvent = buf.append({
        type: 'clear',
        origin: 'human',
        // 调用方故意传入错误 kind / 旧 cursor，应当被强制覆盖
        meta: { kind: 'not-a-clear', precedingCursor: 999, reason: 'custom' },
      });
      expect(clearEvent.meta).toMatchObject({
        kind: 'clear',
        precedingCursor: 1,
        reason: 'custom',
      });
    });

    it('readSince(cursorBeforeClear) yields clear event as a boundary marker', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      const before = buf.latestCursor();
      buf.append({ type: 'clear', origin: 'human' });
      buf.append({ type: 'data', origin: 'device', data: utf8('b') });
      const result = buf.readSince(before);
      expect(result.events.map((e) => e.type)).toEqual(['clear', 'data']);
      expect(result.events[0]?.meta).toMatchObject({ kind: 'clear', precedingCursor: before });
    });
  });

  describe('expired cursor recovery', () => {
    it('returns oldestAvailableSequence so callers can resume after truncation', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1', capacity: 3 });
      for (let i = 0; i < 5; i += 1) {
        buf.append({ type: 'data', origin: 'human', data: utf8(String(i)) });
      }
      const result = buf.readSince(1); // 1 已被丢弃
      expect(result.truncated).toBe(true);
      expect(result.oldestAvailableSequence).toBe(3);
      // 客户端可据此从 oldestAvailableSequence-1 续读，无 truncated 标志
      const recovery = buf.readSince(result.oldestAvailableSequence - 1);
      expect(recovery.truncated).toBe(false);
      expect(recovery.events.map((e) => e.sequence)).toEqual([3, 4, 5]);
    });

    it('oldestAvailableSequence equals latestCursor+1 on empty buffer', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      const result = buf.readSince(0);
      expect(result.events).toEqual([]);
      expect(result.oldestAvailableSequence).toBe(buf.latestCursor() + 1);
      expect(result.oldestAvailableSequence).toBe(1);
    });

    it('oldestAvailableSequence advances after eviction and stays consistent', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1', capacity: 2 });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      buf.append({ type: 'data', origin: 'human', data: utf8('b') });
      let result = buf.readSince(0);
      expect(result.oldestAvailableSequence).toBe(1);
      buf.append({ type: 'data', origin: 'human', data: utf8('c') });
      result = buf.readSince(0);
      expect(result.oldestAvailableSequence).toBe(2);
    });
  });

  describe('snapshot()', () => {
    it('returns the same shape as readSince(0)', () => {
      const buf = new TranscriptBuffer({ sessionId: 's1' });
      buf.append({ type: 'data', origin: 'human', data: utf8('a') });
      buf.append({ type: 'data', origin: 'device', data: utf8('b') });
      const snap = buf.snapshot();
      const ref = buf.readSince(0);
      expect(snap.events.map((e) => e.sequence)).toEqual(ref.events.map((e) => e.sequence));
      expect(snap.cursor).toBe(ref.cursor);
      expect(snap.truncated).toBe(ref.truncated);
      expect(snap.oldestAvailableSequence).toBe(ref.oldestAvailableSequence);
    });
  });
});
