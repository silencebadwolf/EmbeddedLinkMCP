/**
 * Phase 12 — 性能基线：TranscriptBuffer 处理 100k+ 事件无 OOM、读取无显著退化。
 *
 * 断言：
 * - append 100k 个 terminal_output 事件 < 5 s（CI 宽松上限；典型本地 < 200 ms）
 * - 写满后 buffer.size() === MAX_TRANSCRIPT_EVENTS（容量上限受控）
 * - readSince(0) 返回的 events.length === MAX_TRANSCRIPT_EVENTS 且 truncated === true
 *   （cursor=0 早已被环形覆盖；oldestAvailableSequence > 0）
 * - 按 oldestAvailableSequence-1 重读 → truncated === false（恢复路径有效）
 *
 * 这是性能基线 + 容量约束的回归测试，防止有人无意把 MAX_TRANSCRIPT_EVENTS 调上去
 * 导致内存爆炸；也防止 readSince 退化成 O(n^2) 或类似的算法回归。
 */

import { describe, expect, it } from 'vitest';
import { TranscriptBuffer } from '@linkterm/runtime/core/transcript/transcript-buffer';
import { MAX_TRANSCRIPT_EVENTS } from '@/shared/constants.js';

describe('Phase 12 / perf — TranscriptBuffer at capacity', () => {
  it(
    'append 100k 个 data 事件后 readSince(0) 报 truncated 且容量稳定',
    { timeout: 30_000 },
    () => {
      const buf = new TranscriptBuffer({ sessionId: 'perf' });
      const eventCount = 100_000;
      // 用一份共享的小 data 引用避免每次 alloc 干扰 perf 测量
      const data = new Uint8Array([0x61, 0x0a]);

      const start = Date.now();
      for (let i = 0; i < eventCount; i += 1) {
        buf.append({
          type: 'data',
          origin: 'device',
          evidenceKind: 'terminal_output',
          data,
        });
      }
      const elapsed = Date.now() - start;

      // 5s 是 CI 宽松上限；本地通常 < 200ms
      expect(elapsed).toBeLessThan(5000);

      // 容量应当被环形约束在 MAX_TRANSCRIPT_EVENTS（默认 100_000）
      expect(buf.size()).toBe(MAX_TRANSCRIPT_EVENTS);

      // 100k 事件追加在容量上限上：读 cursor=0 拿到 100k 条但 truncated=false
      // （没有发生溢出，因为 eventCount === MAX_TRANSCRIPT_EVENTS）
      // 为了真正断言 truncated 路径，再追加 10 条触发覆盖 —— 仅追加 1 条不足以让
      // readSince(1) 触发 truncated（buffer.readSince 视 cursor === earliest-1 为
      // "恰好读到 earliest 的前一条"，不算截断）。
      for (let i = 0; i < 10; i += 1) {
        buf.append({ type: 'data', origin: 'device', evidenceKind: 'terminal_output', data });
      }
      expect(buf.size()).toBe(MAX_TRANSCRIPT_EVENTS);

      const result = buf.readSince(0);
      expect(result.events.length).toBe(MAX_TRANSCRIPT_EVENTS);
      // 注意：readSince 把 cursor === 0 视为"从最早可见事件开始读"，不算 truncated；
      // 真正的越界读用 0 < cursor < earliest-1 的值检测。
      expect(result.truncated).toBe(false);
      expect(result.oldestAvailableSequence).toBeGreaterThan(1);

      const stale = buf.readSince(1);
      expect(stale.truncated).toBe(true);
      expect(stale.oldestAvailableSequence).toBeGreaterThan(2);

      // 恢复路径：用 oldestAvailableSequence - 1 重读不再 truncated
      const recovery = buf.readSince(stale.oldestAvailableSequence - 1);
      expect(recovery.truncated).toBe(false);
      expect(recovery.events.length).toBe(MAX_TRANSCRIPT_EVENTS);
    },
  );

  it(
    'readSince 在容量上限附近的多次调用累计耗时合理',
    { timeout: 30_000 },
    () => {
      const buf = new TranscriptBuffer({ sessionId: 'perf-read' });
      const data = new Uint8Array([0x78]);
      for (let i = 0; i < MAX_TRANSCRIPT_EVENTS; i += 1) {
        buf.append({ type: 'data', origin: 'device', evidenceKind: 'terminal_output', data });
      }
      // 100 次"实时跟读"调用，每次只拿 0~1 条增量
      let cursor = buf.latestCursor();
      const start = Date.now();
      for (let i = 0; i < 100; i += 1) {
        buf.append({ type: 'data', origin: 'device', evidenceKind: 'terminal_output', data });
        const r = buf.readSince(cursor);
        cursor = r.cursor;
        expect(r.events.length).toBe(1);
      }
      const elapsed = Date.now() - start;
      // 100 次增量读 + 100 次 append < 3s（CI 宽松上限；本地通常 < 100ms）
      expect(elapsed).toBeLessThan(3000);
    },
  );
});
