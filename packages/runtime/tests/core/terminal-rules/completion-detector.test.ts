import { describe, expect, it } from 'vitest';
import { CompletionDetector } from '@linkterm/runtime/core/terminal-rules/completion-detector';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('CompletionDetector', () => {
  it('matches a string marker arriving in a single chunk', () => {
    const det = new CompletionDetector(['OK\r\n'], 64 * 1024);
    const state = det.feed(utf8('result OK\r\n'));
    expect(state.matched).toBe(true);
    expect(state.matchedMarkerIndex).toBe(0);
    expect(state.matchEndByte).toBe(utf8('result OK\r\n').byteLength);
  });

  it('matches a string marker that straddles two chunks', () => {
    const det = new CompletionDetector(['DONE'], 64 * 1024);
    expect(det.feed(utf8('foo DO')).matched).toBe(false);
    const out = det.feed(utf8('NE bar'));
    expect(out.matched).toBe(true);
    expect(out.matchedMarkerIndex).toBe(0);
  });

  it('matches a string marker that straddles three chunks', () => {
    const det = new CompletionDetector(['HELLOWORLD'], 64 * 1024);
    expect(det.feed(utf8('HELL')).matched).toBe(false);
    expect(det.feed(utf8('OWOR')).matched).toBe(false);
    expect(det.feed(utf8('LD!!')).matched).toBe(true);
  });

  it('matches a string marker that straddles five tiny chunks', () => {
    const det = new CompletionDetector(['ABCDE'], 64 * 1024);
    for (const c of ['A', 'B', 'C', 'D']) {
      expect(det.feed(utf8(c)).matched).toBe(false);
    }
    expect(det.feed(utf8('E')).matched).toBe(true);
  });

  it('handles empty chunks gracefully', () => {
    const det = new CompletionDetector(['OK'], 64 * 1024);
    expect(det.feed(new Uint8Array(0)).matched).toBe(false);
    expect(det.feed(new Uint8Array(0)).totalBytes).toBe(0);
  });

  it('Unicode 4-byte emoji split across chunks still matches by bytes', () => {
    // U+1F600 (😀) UTF-8 bytes: F0 9F 98 80
    const emoji = utf8('😀');
    expect(emoji.length).toBe(4);
    const det = new CompletionDetector(['😀'], 64 * 1024);
    expect(det.feed(emoji.slice(0, 1)).matched).toBe(false);
    expect(det.feed(emoji.slice(1, 3)).matched).toBe(false);
    const final = det.feed(emoji.slice(3));
    expect(final.matched).toBe(true);
  });

  it('selects the marker that comes first in the array on simultaneous match', () => {
    const det = new CompletionDetector(['OK', 'OK'], 64 * 1024);
    const state = det.feed(utf8('OK'));
    expect(state.matched).toBe(true);
    expect(state.matchedMarkerIndex).toBe(0);
  });

  it('selects the earliest-firing marker (within the same chunk)', () => {
    // 'A' fires at byte 0 of 'ABC...'; 'C' fires at byte 2.
    const det = new CompletionDetector(['C', 'A'], 64 * 1024);
    const state = det.feed(utf8('ABC'));
    expect(state.matched).toBe(true);
    // Per byte-by-byte loop: 'A' fires at byte 0 (mi=1); 'C' would fire later;
    // but the algorithm checks markers in array order at each byte.
    // At byte 0: marker 0 ('C') doesn't match, marker 1 ('A') matches -> matchedMarkerIndex=1
    expect(state.matchedMarkerIndex).toBe(1);
  });

  it('partial match resets via KMP failure when followed by mismatched byte', () => {
    // marker 'ABABC': feed 'ABABA' should not match (KMP backs off correctly)
    const det = new CompletionDetector(['ABABC'], 64 * 1024);
    expect(det.feed(utf8('ABABA')).matched).toBe(false);
    // continuing with 'BABC' completes the marker
    const state = det.feed(utf8('BABC'));
    expect(state.matched).toBe(true);
  });

  it('matches a RegExp marker via accumulated buffer', () => {
    const det = new CompletionDetector([/[a-z]+\$/], 64 * 1024);
    expect(det.feed(utf8('user@host:~')).matched).toBe(false);
    expect(det.feed(utf8('foo$')).matched).toBe(true);
  });

  it('drops buffer head when exceeding bufferMaxBytes but keeps tail for marker matching', () => {
    // bufferMaxBytes very small to force eviction
    const det = new CompletionDetector([/ZZZZ/], 16);
    // Push 200 bytes that don't match
    det.feed(new Uint8Array(200).fill(0x41)); // AAAAA...
    expect(det.feed(utf8('ZZZZ')).matched).toBe(true);
    // buffer should not exceed maxBytes by more than tailWindow (max(longestRegex*4,4096) clamped to maxBytes)
    expect(det.snapshotBuffer().byteLength).toBeLessThanOrEqual(16);
  });

  it('reset() clears state and allows re-matching', () => {
    const det = new CompletionDetector(['OK'], 64 * 1024);
    expect(det.feed(utf8('OK')).matched).toBe(true);
    det.reset();
    expect(det.feed(utf8('not yet')).matched).toBe(false);
    expect(det.feed(utf8('OK')).matched).toBe(true);
  });

  it('snapshotBuffer returns an independent copy', () => {
    const det = new CompletionDetector([/x/], 64 * 1024);
    det.feed(utf8('hello'));
    const snap1 = det.snapshotBuffer();
    snap1[0] = 0xff;
    const snap2 = det.snapshotBuffer();
    expect(snap2[0]).not.toBe(0xff);
  });

  it('matched stays true after subsequent feeds; totalBytes accumulates', () => {
    const det = new CompletionDetector(['OK'], 64 * 1024);
    expect(det.feed(utf8('OK')).matched).toBe(true);
    const state = det.feed(utf8('more bytes'));
    expect(state.matched).toBe(true);
    expect(state.totalBytes).toBeGreaterThanOrEqual(2 + 'more bytes'.length);
  });

  it('with no markers configured, never matches', () => {
    const det = new CompletionDetector([], 64 * 1024);
    const state = det.feed(utf8('lots of output'));
    expect(state.matched).toBe(false);
  });
});
