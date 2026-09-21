/**
 * Phase 12 — 性能基线 + 优先级回归：WriteQueue 在高并发下保持优先级语义、
 * maxDepth 背压、high 豁免，且整体吞吐合理。
 *
 * 断言：
 * - 1000 个 normal + 100 个 high 并发 enqueue 后：blocking 首项之后 high 全部
 *   抢占在 normal 之前 drain；
 * - 总耗时 < 2s；
 * - maxDepth=1024 满时第 1025 个 normal 立即抛 WriteQueueFullError；
 * - 队列满时 high 仍可入队（豁免 maxDepth）。
 *
 * 这覆盖 PROJECT_REQUIREMENTS §4.4/§5.1 "用户中断必须可达" 的高并发回归
 * （ai-human-coop.test.ts 的 H2 测了基础顺序，这里加大 N + 加 maxDepth 回归）。
 */

import { describe, expect, it } from 'vitest';
import { SessionBase } from '@linkterm/runtime/core/session/session-base';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import type { SessionId } from '@/shared/types.js';
import { WriteQueue } from '@linkterm/runtime/core/write-queue/write-queue';
import { WriteQueueFullError } from '@linkterm/runtime/core/write-queue/types';
import { MockTransport } from '../fixtures/mock-transport.js';

class TestSession extends SessionBase {
  constructor(id: SessionId, public readonly transport: MockTransport) {
    super({ id, transport });
  }
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('Phase 12 / perf — WriteQueue under high concurrency', () => {
  it(
    '1000 normal + 100 high 并发：blocking 后 high 先于 normal drain，总耗时 < 2s',
    { timeout: 30_000 },
    async () => {
      const manager = new SessionManager();
      const transport = new MockTransport();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const writeOriginal = transport.write.bind(transport);
      let callCount = 0;
      transport.write = async (data: Uint8Array): Promise<void> => {
        callCount += 1;
        if (callCount === 1) await gate;
        return writeOriginal(data);
      };

      const session = manager.create((id) => new TestSession(id, transport));
      await session.open();

      // 锁住首项
      const blocking = session.write(utf8('blocking'), { origin: 'human' });

      // 并发堆积 1000 normal + 100 high
      const normalPromises: Promise<void>[] = [];
      const highPromises: Promise<void>[] = [];
      for (let i = 0; i < 1000; i += 1) {
        normalPromises.push(session.write(utf8(`n${i}`), { origin: 'ai' }));
      }
      for (let i = 0; i < 100; i += 1) {
        highPromises.push(
          session.write(utf8(`h${i}`), { origin: 'human', priority: 'high' }),
        );
      }

      const start = Date.now();
      release();
      await Promise.all([blocking, ...normalPromises, ...highPromises]);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);

      const tags = transport.writes.map(decode);
      expect(tags.length).toBe(1 + 1000 + 100);
      // 锁住的项必为首
      expect(tags[0]).toBe('blocking');
      // 之后 100 个 high 全部出现在所有 normal 之前
      const firstNormalIdx = tags.findIndex((t) => t.startsWith('n'));
      const lastHighIdx = tags.map((t, i) => (t.startsWith('h') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      expect(lastHighIdx).toBeLessThan(firstNormalIdx);
      // high lane FIFO 内有序
      const highTags = tags.filter((t) => t.startsWith('h'));
      expect(highTags).toEqual(Array.from({ length: 100 }, (_, i) => `h${i}`));
      // normal lane FIFO 内有序
      const normalTags = tags.filter((t) => t.startsWith('n'));
      expect(normalTags).toEqual(Array.from({ length: 1000 }, (_, i) => `n${i}`));

      await manager.destroyAll();
    },
  );

  it(
    'normal 在 maxDepth=1024 满时第 1025 个抛 WriteQueueFullError；high 豁免',
    { timeout: 30_000 },
    async () => {
      // 直接用 WriteQueue 测 maxDepth 边界 —— SessionBase 默认 maxDepth=1024 但不可配置；
      // WriteQueue 单测已覆盖该路径，这里再做"满载并发"回归。
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let writes = 0;
      const queue = new WriteQueue({
        writer: async () => {
          writes += 1;
          if (writes === 1) await gate;
        },
      });

      // 第 1 个进入 #running
      const first = queue.enqueue({ origin: 'human', data: utf8('blocking') });
      // 再塞 1023 个 normal → pendingCount 累计到 1024 = maxDepth
      const normals: Promise<void>[] = [first];
      for (let i = 0; i < 1023; i += 1) {
        normals.push(queue.enqueue({ origin: 'ai', data: utf8(`n${i}`) }));
      }
      expect(queue.pendingCount()).toBe(1024);

      // 第 1025 个 normal 立即同步 reject
      let queueFullError: unknown;
      try {
        await queue.enqueue({ origin: 'ai', data: utf8('overflow') });
      } catch (e) {
        queueFullError = e;
      }
      expect(queueFullError).toBeInstanceOf(WriteQueueFullError);
      expect((queueFullError as WriteQueueFullError).code).toBe('QUEUE_FULL');

      // high 即使队列满也能入队（豁免）
      const highPromise = queue.enqueue({ origin: 'human', data: utf8('h-bypass'), priority: 'high' });
      // 此时 pendingCount = 1025（high 已入 high lane）
      expect(queue.pendingCount()).toBe(1025);

      // 释放后所有项最终 settle
      release();
      await Promise.all([...normals, highPromise]);

      // 写入次数 = 1 (blocking) + 1023 (normal) + 1 (high) = 1025
      expect(writes).toBe(1025);
      await queue.close();
    },
  );
});
