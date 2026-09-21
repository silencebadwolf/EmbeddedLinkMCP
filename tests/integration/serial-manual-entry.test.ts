/**
 * Phase 12 — 边界场景 2：自动发现返回空，用户手动输入端口仍能创建会话。
 *
 * 验证：
 * - SerialDiscovery 注入 `listFn = async () => []` 时 `listPorts()` 返回空数组；
 * - 即便 discovery 啥也不报，`SessionManager.createAndOpen` 直接拿到一个用户手动
 *   输入的任意 path（如 macOS 上 `/dev/cu.usbserial-AB0LXXX` 不在 list 里也能用），
 *   仍然能成功 open；
 * - 这覆盖了 "udev/USB 信息不可靠时用户能手动绕过" 的关键路径（PROJECT_REQUIREMENTS §6 场景 2）。
 *
 * 不依赖渲染层 ConnectionDialog —— 该组件由 ConnectionDialog 单测覆盖；这里只验
 * 主进程业务逻辑层。
 */

import { describe, expect, it } from 'vitest';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import { SerialSession } from '@linkterm/runtime/transports/serial/serial-session';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import type { SessionId } from '@/shared/types.js';
import { createMockSerialPortFactory } from '../fixtures/mock-serialport.js';

describe('Phase 12 / scenario 2 — empty discovery + manual entry', () => {
  it('listPorts 返回空数组', async () => {
    const discovery = new SerialDiscovery({ listFn: async () => [] });
    try {
      const ports = await discovery.listPorts();
      expect(ports).toEqual([]);
    } finally {
      discovery.dispose();
    }
  });

  it('discovery 为空时仍可创建任意 path 的 session 并 open 成功', async () => {
    const discovery = new SerialDiscovery({ listFn: async () => [] });
    const manager = new SessionManager();
    const { factory, created } = createMockSerialPortFactory();

    try {
      // discovery 表为空
      const ports = await discovery.listPorts();
      expect(ports).toHaveLength(0);

      // 用户手动输入一个完全不在 discovery 里的 path
      const fakePath = '/dev/totally-fake-port';
      const session = await manager.createAndOpen((id: SessionId) => {
        return new SerialSession({
          id,
          config: { type: 'serial', port: fakePath, baudRate: 115200, mode: 'normal' },
          portFactory: factory,
        });
      });

      expect(session.state).toBe('open');
      expect(created).toHaveLength(1);
      // factory 收到的 options 应当原样保留用户输入的 path —— 验证 manual entry 路径未被
      // discovery 列表过滤
      expect(created[0]!.options.path).toBe(fakePath);
      expect(created[0]!.options.baudRate).toBe(115200);

      // session 仍能正常写入（验证 transport 链路通畅，不是 stub）
      await manager.write(session.id, new TextEncoder().encode('hi\n'), { origin: 'human' });
      expect(created[0]!.writes.length).toBeGreaterThan(0);
    } finally {
      await manager.destroyAll();
      discovery.dispose();
    }
  });
});
