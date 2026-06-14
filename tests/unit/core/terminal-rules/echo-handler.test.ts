import { describe, expect, it } from 'vitest';
import { EchoHandler } from '@/core/terminal-rules/echo-handler.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('EchoHandler', () => {
  it('strips an exactly-echoed write from device output', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('ls\r\n'));
    const out = echo.filter(utf8('ls\r\nfile1\n'));
    expect(decode(out)).toBe('file1\n');
  });

  it('strips echo arriving across multiple chunks', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('hello\r\n'));
    expect(decode(echo.filter(utf8('hel')))).toBe('');
    expect(decode(echo.filter(utf8('lo')))).toBe('');
    const tail = echo.filter(utf8('\r\nbody'));
    expect(decode(tail)).toBe('body');
  });

  it("when first byte mismatches, falls back to passing the chunk through (and clears expected)", () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('expected'));
    const out = echo.filter(utf8('XYZdiff'));
    expect(decode(out)).toBe('XYZdiff');
    // Expected queue should be cleared; subsequent matching of the original write shouldn't strip
    const out2 = echo.filter(utf8('expected'));
    expect(decode(out2)).toBe('expected');
  });

  it('keep strategy passes everything through and ignores observeWrite', () => {
    const echo = new EchoHandler('keep');
    echo.observeWrite(utf8('ls\r\n'));
    const out = echo.filter(utf8('ls\r\nfile1\n'));
    expect(decode(out)).toBe('ls\r\nfile1\n');
  });

  it('observeWrite past MAX_QUEUE_LEN flushes queue (echo-off device safety bound)', () => {
    const echo = new EchoHandler('auto');
    // 入队 4097 次 1 字节写入；硬上限 4096 触发后整列 flush
    for (let i = 0; i < 4097; i++) echo.observeWrite(utf8('x'));
    // 现在 expected 为空，device 输出按透传返回
    const out = echo.filter(utf8('passthrough'));
    expect(decode(out)).toBe('passthrough');
  });

  it('multiple observeWrite calls are queued FIFO', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('one'));
    echo.observeWrite(utf8('two'));
    // device echoes both writes back-to-back, then the actual reply
    const out = echo.filter(utf8('onetwo>>'));
    expect(decode(out)).toBe('>>');
  });

  it('handles empty chunk', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('x'));
    const out = echo.filter(new Uint8Array(0));
    expect(out.byteLength).toBe(0);
  });

  it('reset clears expected queue', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('cmd'));
    echo.reset();
    const out = echo.filter(utf8('cmdrest'));
    expect(decode(out)).toBe('cmdrest');
  });

  it('partial match within a chunk: consume head bytes and pass the rest after mismatch', () => {
    const echo = new EchoHandler('auto');
    echo.observeWrite(utf8('AB')); // expects 'AB'
    // Actual chunk: 'AXrest' — first byte 'A' matches; second byte 'X' mismatches with expected 'B'
    const out = echo.filter(utf8('AXrest'));
    // After consuming 'A', mismatch on 'X' clears expected; the remainder 'Xrest' passes through
    expect(decode(out)).toBe('Xrest');
  });
});
