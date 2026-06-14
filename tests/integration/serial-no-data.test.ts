/**
 * Phase 12 — 边界场景 1：串口连接成功但设备完全沉默。
 *
 * 验证：
 * - session 顺利进入 `open` 状态（透传到 SerialTransport.open 成功）；
 * - transcript 中**绝不出现** `type: 'data'` 事件 —— 没有任何 device 字节进来；
 * - 仅有 system 起源的 `state` 事件（idle→opening→open）。
 *
 * 这是嵌入式排错最常见的"我已经接上了但什么都不出"场景；在终端模式 sendAndWait
 * 里它会触发 timeout，但裸的 `read()` 路径必须能给 UI 一个清晰的"无数据"展示
 * 而不是被某个伪造的 hello message 误导。
 */

import { describe, expect, it } from 'vitest';
import { SerialSession } from '@/transports/serial/serial-session.js';
import { SessionManager } from '@/core/session/session-manager.js';
import type { SessionId } from '@/shared/types.js';
import { createMockSerialPortFactory } from '../fixtures/mock-serialport.js';

describe('Phase 12 / scenario 1 — serial connected but no data', () => {
  it('open 成功后 transcript 仅含 state 事件，无 data', async () => {
    const manager = new SessionManager();
    const { factory, created } = createMockSerialPortFactory();

    const session = await manager.createAndOpen((id: SessionId) => {
      return new SerialSession({
        id,
        config: { type: 'serial', port: '/dev/ttyUSB-silent', baudRate: 115200, mode: 'normal' },
        portFactory: factory,
      });
    });

    // 让任何潜在的 microtask 排空（open 'open' 事件、queueMicrotask 收尾等）
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(session.state).toBe('open');
    expect(created).toHaveLength(1);

    // 关键断言：未调 pushIncoming → 没有 data 事件
    const result = manager.read(session.id, 0);
    const dataEvents = result.events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(0);

    // 应有 state 事件证明确实走过 open，避免"读到空"是因为 read 失败
    const stateEvents = result.events.filter((e) => e.type === 'state');
    expect(stateEvents.length).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(false);

    await manager.destroyAll();
  });

  it('保持沉默 50ms 后仍然无 data 事件', async () => {
    const manager = new SessionManager();
    const { factory } = createMockSerialPortFactory();

    const session = await manager.createAndOpen((id: SessionId) => {
      return new SerialSession({
        id,
        config: { type: 'serial', port: '/dev/ttyUSB-silent', baudRate: 9600, mode: 'normal' },
        portFactory: factory,
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    const result = manager.read(session.id, 0);
    expect(result.events.filter((e) => e.type === 'data')).toHaveLength(0);
    expect(session.state).toBe('open');

    await manager.destroyAll();
  });
});
