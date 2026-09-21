import { describe, expect, it, vi } from 'vitest';
import { WriteQueue } from '@linkterm/runtime/core/write-queue/write-queue';
import { WriteQueueFullError } from '@linkterm/runtime/core/write-queue/types';
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

  it('notifies onStart before writer can synchronously emit a device echo', async () => {
    const order: string[] = [];
    const queue = new WriteQueue({
      onStart: (item) => {
        order.push(`start:${new TextDecoder().decode(item.data)}`);
      },
      writer: async (data) => {
        order.push(`writer:${new TextDecoder().decode(data)}`);
      },
    });

    await queue.enqueue({ origin: 'ai', data: utf8('mstart\r\n') });

    expect(order).toEqual(['start:mstart\r\n', 'writer:mstart\r\n']);
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

  describe('priority', () => {
    it('drains high-priority items before normal even when normal arrived first', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const log: string[] = [];
      const queue = new WriteQueue({
        writer: async (data) => {
          log.push(new TextDecoder().decode(data));
        },
      });
      // 先入队一个挂起的 normal，让 #running=true，期间堆积新 item
      const slow = new WriteQueue({
        writer: async (data) => {
          await gate;
          log.push(new TextDecoder().decode(data));
        },
      });

      // Use a single queue for proper test
      const p0 = slow.enqueue({ origin: 'human', data: utf8('blocking') });
      // 现在 blocking 还没 settle；后续 enqueue 会按优先级分流
      slow.enqueue({ origin: 'ai', data: utf8('n1') }).catch(() => undefined);
      slow.enqueue({ origin: 'ai', data: utf8('n2') }).catch(() => undefined);
      slow.enqueue({ origin: 'human', data: utf8('h1'), priority: 'high' }).catch(() => undefined);
      slow.enqueue({ origin: 'human', data: utf8('h2'), priority: 'high' }).catch(() => undefined);

      release();
      await p0;
      await slow.close();
      // blocking 是首项，必先；之后高优先级 h1/h2 先于 n1/n2 被取出
      expect(log).toEqual(['blocking', 'h1', 'h2', 'n1', 'n2']);
      // suppress unused-variable lint
      void queue;
    });

    it('preserves FIFO within the same priority lane', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const log: string[] = [];
      const queue = new WriteQueue({
        writer: async (data) => {
          if (log.length === 0) await gate; // 卡住第一项让后续堆积
          log.push(new TextDecoder().decode(data));
        },
      });
      const p0 = queue.enqueue({ origin: 'human', data: utf8('first') });
      const ps = [
        queue.enqueue({ origin: 'human', data: utf8('h1'), priority: 'high' }),
        queue.enqueue({ origin: 'human', data: utf8('h2'), priority: 'high' }),
        queue.enqueue({ origin: 'human', data: utf8('h3'), priority: 'high' }),
      ];
      release();
      await Promise.all([p0, ...ps]);
      expect(log).toEqual(['first', 'h1', 'h2', 'h3']);
    });

    it('default priority is normal', async () => {
      const log: string[] = [];
      const queue = new WriteQueue({
        writer: async (data) => {
          log.push(new TextDecoder().decode(data));
        },
      });
      await queue.enqueue({ origin: 'ai', data: utf8('a') });
      await queue.enqueue({ origin: 'ai', data: utf8('b') });
      // 没有挂起任务 → 即时执行 → 顺序就是 FIFO
      expect(log).toEqual(['a', 'b']);
    });
  });

  describe('correlationId', () => {
    it('passes correlationId through to audit callback unchanged', async () => {
      const audit = vi.fn();
      const queue = new WriteQueue({ writer: async () => undefined, audit });
      await queue.enqueue({
        origin: 'ai',
        data: utf8('hi'),
        correlationId: 'req-42',
      });
      const [item] = audit.mock.calls[0]!;
      expect((item as { correlationId: string }).correlationId).toBe('req-42');
    });

    it('keeps each item correlationId independent across concurrent submissions', async () => {
      const seenCorrelations: (string | undefined)[] = [];
      const queue = new WriteQueue({
        writer: async () => undefined,
        audit: (item) => seenCorrelations.push(item.correlationId),
      });
      await Promise.all([
        queue.enqueue({ origin: 'ai', data: utf8('a'), correlationId: 'c1' }),
        queue.enqueue({ origin: 'ai', data: utf8('b'), correlationId: 'c2' }),
        queue.enqueue({ origin: 'human', data: utf8('c') }),
        queue.enqueue({ origin: 'ai', data: utf8('d'), correlationId: 'c3' }),
      ]);
      expect(seenCorrelations).toEqual(['c1', 'c2', undefined, 'c3']);
    });
  });

  describe('backpressure', () => {
    it('rejects with WriteQueueFullError when depth exceeds maxDepth', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const queue = new WriteQueue({
        writer: async () => {
          await gate;
        },
        maxDepth: 2,
      });
      // 1 项进入运行态 + 1 项排队 = depth 2，已达上限
      const p0 = queue.enqueue({ origin: 'human', data: utf8('a') });
      const p1 = queue.enqueue({ origin: 'human', data: utf8('b') });
      // 第三项应当立即被拒
      const p2 = queue.enqueue({ origin: 'human', data: utf8('c') });
      await expect(p2).rejects.toBeInstanceOf(WriteQueueFullError);
      await expect(p2).rejects.toMatchObject({ code: 'QUEUE_FULL' });
      release();
      await Promise.all([p0, p1]);
    });

    it('allows new items after queue drains below maxDepth', async () => {
      const queue = new WriteQueue({
        writer: async () => undefined,
        maxDepth: 2,
      });
      await queue.enqueue({ origin: 'human', data: utf8('a') });
      await queue.enqueue({ origin: 'human', data: utf8('b') });
      // 已经 drain 完，能继续接受
      await expect(
        queue.enqueue({ origin: 'human', data: utf8('c') }),
      ).resolves.toBeUndefined();
    });

    it('rejects ALL late submissions while queue is full (concurrent storm)', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const queue = new WriteQueue({
        writer: async () => {
          await gate;
        },
        maxDepth: 4,
      });
      // 占满 4 个槽位
      const filled = Array.from({ length: 4 }, (_, i) =>
        queue.enqueue({ origin: 'human', data: utf8(`f${i}`) }),
      );
      // 再投 6 个，应当全部被拒
      const overflow = Array.from({ length: 6 }, (_, i) =>
        queue.enqueue({ origin: 'human', data: utf8(`x${i}`) }),
      );
      const results = await Promise.allSettled(overflow);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      release();
      await Promise.all(filled);
    });

    it('rejects construction when maxDepth is invalid', () => {
      expect(() => new WriteQueue({ writer: async () => undefined, maxDepth: 0 })).toThrow();
      expect(() => new WriteQueue({ writer: async () => undefined, maxDepth: -1 })).toThrow();
      expect(() => new WriteQueue({ writer: async () => undefined, maxDepth: 1.5 })).toThrow();
    });

    it('high-priority enqueue bypasses maxDepth and drains before remaining normal items', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const log: string[] = [];
      const queue = new WriteQueue({
        writer: async (data) => {
          if (log.length === 0) await gate; // 卡住第一项让队列堆积
          log.push(new TextDecoder().decode(data));
        },
        maxDepth: 3,
      });
      // depth=3：1 项运行中 + 2 项排队 = 已达上限
      const p0 = queue.enqueue({ origin: 'human', data: utf8('blocking') });
      const pn1 = queue.enqueue({ origin: 'ai', data: utf8('n1') });
      const pn2 = queue.enqueue({ origin: 'ai', data: utf8('n2') });
      // normal 现在被拒
      await expect(
        queue.enqueue({ origin: 'ai', data: utf8('n3') }),
      ).rejects.toBeInstanceOf(WriteQueueFullError);
      // 但 high 仍能入队（即便此时 pendingCount >= maxDepth）
      const ph1 = queue.enqueue({ origin: 'human', data: utf8('h1'), priority: 'high' });
      const ph2 = queue.enqueue({ origin: 'human', data: utf8('h2'), priority: 'high' });
      release();
      await Promise.all([p0, pn1, pn2, ph1, ph2]);
      // blocking 是首项；之后 high 先于剩余 normal 被取出
      expect(log).toEqual(['blocking', 'h1', 'h2', 'n1', 'n2']);
    });
  });
});
