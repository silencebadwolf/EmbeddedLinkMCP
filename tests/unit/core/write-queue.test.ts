import { describe, expect, it, vi } from 'vitest';
import { WriteQueue } from '@/core/write-queue/write-queue.js';
import type { Origin } from '@/shared/types.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('WriteQueue', () => {
  it('processes items in FIFO order', async () => {
    const log: string[] = [];
    const queue = new WriteQueue({
      writer: async (data) => {
        log.push(new TextDecoder().decode(data));
      },
    });

    await Promise.all([
      queue.enqueue({ origin: 'human', data: utf8('a') }),
      queue.enqueue({ origin: 'ai', data: utf8('b') }),
      queue.enqueue({ origin: 'human', data: utf8('c') }),
    ]);

    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('serializes async writes (no overlap)', async () => {
    const order: string[] = [];
    const queue = new WriteQueue({
      writer: async (data) => {
        const tag = new TextDecoder().decode(data);
        order.push(`start:${tag}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${tag}`);
      },
    });
    await Promise.all([
      queue.enqueue({ origin: 'human', data: utf8('a') }),
      queue.enqueue({ origin: 'ai', data: utf8('b') }),
    ]);
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('invokes audit callback with origin and bytes for successful writes', async () => {
    const audit = vi.fn();
    const queue = new WriteQueue({ writer: async () => undefined, audit });
    await queue.enqueue({ origin: 'ai', data: utf8('hi'), correlationId: 'abc' });
    expect(audit).toHaveBeenCalledTimes(1);
    const [item, result] = audit.mock.calls[0]!;
    expect((item as { origin: Origin }).origin).toBe('ai');
    expect((item as { correlationId: string }).correlationId).toBe('abc');
    expect(result).toEqual({ ok: true, bytesWritten: 2 });
  });

  it('continues processing subsequent items after one fails', async () => {
    const writes: string[] = [];
    let callIndex = 0;
    const queue = new WriteQueue({
      writer: async (data) => {
        callIndex += 1;
        if (callIndex === 2) throw new Error('boom');
        writes.push(new TextDecoder().decode(data));
      },
    });

    const p1 = queue.enqueue({ origin: 'human', data: utf8('a') });
    const p2 = queue.enqueue({ origin: 'human', data: utf8('b') });
    const p3 = queue.enqueue({ origin: 'human', data: utf8('c') });

    await expect(p1).resolves.toBeUndefined();
    await expect(p2).rejects.toThrow('boom');
    await expect(p3).resolves.toBeUndefined();
    expect(writes).toEqual(['a', 'c']);
  });

  it('reports audit failure on writer rejection', async () => {
    const audit = vi.fn();
    const queue = new WriteQueue({
      writer: async () => {
        throw new Error('nope');
      },
      audit,
    });
    await expect(queue.enqueue({ origin: 'human', data: utf8('x') })).rejects.toThrow('nope');
    expect(audit).toHaveBeenCalledTimes(1);
    const [, result] = audit.mock.calls[0]!;
    expect(result.ok).toBe(false);
  });

  it('rejects new enqueue after close()', async () => {
    const queue = new WriteQueue({ writer: async () => undefined });
    await queue.close();
    await expect(queue.enqueue({ origin: 'human', data: utf8('x') })).rejects.toThrow(
      /closed/i,
    );
  });

  it('close() drains pending items before resolving', async () => {
    const writes: string[] = [];
    const queue = new WriteQueue({
      writer: async (data) => {
        await new Promise((r) => setTimeout(r, 5));
        writes.push(new TextDecoder().decode(data));
      },
    });
    queue.enqueue({ origin: 'human', data: utf8('a') }).catch(() => undefined);
    queue.enqueue({ origin: 'human', data: utf8('b') }).catch(() => undefined);
    await queue.close();
    expect(writes).toEqual(['a', 'b']);
  });

  it('pendingCount reflects in-flight items', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const queue = new WriteQueue({
      writer: async () => {
        await gate;
      },
    });
    queue.enqueue({ origin: 'human', data: utf8('a') }).catch(() => undefined);
    queue.enqueue({ origin: 'ai', data: utf8('b') }).catch(() => undefined);
    expect(queue.pendingCount()).toBe(2);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.pendingCount()).toBe(0);
  });

  it('preserves AI/human interleaving order as submitted', async () => {
    const log: Array<{ origin: Origin; tag: string }> = [];
    const queue = new WriteQueue({
      writer: async () => undefined,
      audit: (item, result) => {
        if (result.ok) log.push({ origin: item.origin, tag: new TextDecoder().decode(item.data) });
      },
    });
    await Promise.all([
      queue.enqueue({ origin: 'human', data: utf8('h1') }),
      queue.enqueue({ origin: 'ai', data: utf8('a1') }),
      queue.enqueue({ origin: 'human', data: utf8('h2') }),
      queue.enqueue({ origin: 'ai', data: utf8('a2') }),
    ]);
    expect(log.map((x) => x.tag)).toEqual(['h1', 'a1', 'h2', 'a2']);
  });
});
