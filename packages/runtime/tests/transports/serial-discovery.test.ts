import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import type { SerialPortInfo } from '@/shared/types.js';

const flushTimers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const port = (path: string, extra: Partial<SerialPortInfo> = {}): SerialPortInfo => ({
  path,
  ...extra,
});

describe('SerialDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('listPorts() returns the underlying list normalized to SerialPortInfo', async () => {
    const listFn = vi.fn().mockResolvedValue([
      port('/dev/ttyUSB0', { manufacturer: 'FTDI', vendorId: '0403', extra: 'drop' as never }),
      port('COM8', { friendlyName: 'USB-Enhanced-SERIAL CH343 (COM8)' }),
    ]);
    const d = new SerialDiscovery({ listFn });
    const ports = await d.listPorts();
    expect(ports).toEqual([
      { path: '/dev/ttyUSB0', manufacturer: 'FTDI', vendorId: '0403' },
      { path: 'COM8', friendlyName: 'USB-Enhanced-SERIAL CH343 (COM8)' },
    ]);
    // 调用 listPorts 不应启动定时器
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts polling only when a change listener is added', async () => {
    const listFn = vi.fn().mockResolvedValue([port('/dev/ttyUSB0')]);
    const d = new SerialDiscovery({ listFn, pollIntervalMs: 1000 });
    expect(vi.getTimerCount()).toBe(0);
    d.on('change', () => {});
    expect(vi.getTimerCount()).toBe(1);
    d.dispose();
  });

  it('stops polling when the last change listener is removed', async () => {
    const listFn = vi.fn().mockResolvedValue([port('/dev/ttyUSB0')]);
    const d = new SerialDiscovery({ listFn, pollIntervalMs: 1000 });
    const a = (): void => {};
    const b = (): void => {};
    d.on('change', a);
    d.on('change', b);
    expect(vi.getTimerCount()).toBe(1);
    d.off('change', a);
    expect(vi.getTimerCount()).toBe(1); // 仍有一位订阅者
    d.off('change', b);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('emits change only when port set differs', async () => {
    const responses: SerialPortInfo[][] = [
      [port('/dev/ttyUSB0')],
      [port('/dev/ttyUSB0')], // 与上一次相同 —— 不应触发
      [port('/dev/ttyUSB0'), port('/dev/ttyUSB1')], // 新增 —— 触发
    ];
    let i = 0;
    const listFn = vi.fn().mockImplementation(async () => responses[i++] ?? []);
    const d = new SerialDiscovery({ listFn, pollIntervalMs: 1000 });
    const events: SerialPortInfo[][] = [];
    d.on('change', (p) => events.push([...p]));

    // 第一次立即调用（startPolling 内部触发）
    await flushTimers();
    expect(events).toHaveLength(1);
    expect(events[0]!.map((p) => p.path)).toEqual(['/dev/ttyUSB0']);

    vi.advanceTimersByTime(1000);
    await flushTimers();
    expect(events).toHaveLength(1); // 无变化

    vi.advanceTimersByTime(1000);
    await flushTimers();
    expect(events).toHaveLength(2);
    expect(events[1]!.map((p) => p.path).sort()).toEqual(['/dev/ttyUSB0', '/dev/ttyUSB1']);

    d.dispose();
  });

  it('snapshot comparison is order-independent', async () => {
    const responses: SerialPortInfo[][] = [
      [port('/dev/a'), port('/dev/b')],
      [port('/dev/b'), port('/dev/a')], // 顺序不同但集合相同 —— 不应触发
    ];
    let i = 0;
    const listFn = vi.fn().mockImplementation(async () => responses[i++] ?? []);
    const d = new SerialDiscovery({ listFn, pollIntervalMs: 1000 });
    const events: SerialPortInfo[][] = [];
    d.on('change', (p) => events.push([...p]));
    await flushTimers();
    vi.advanceTimersByTime(1000);
    await flushTimers();
    expect(events).toHaveLength(1);
    d.dispose();
  });

  it('emits error and continues polling when listFn rejects transiently', async () => {
    const responses: Array<SerialPortInfo[] | Error> = [
      new Error('boom'),
      [port('/dev/ttyUSB0')],
    ];
    let i = 0;
    const listFn = vi.fn().mockImplementation(async () => {
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r ?? [];
    });
    const d = new SerialDiscovery({ listFn, pollIntervalMs: 1000 });
    const errors: Error[] = [];
    const changes: SerialPortInfo[][] = [];
    d.on('error', (e) => errors.push(e));
    d.on('change', (p) => changes.push([...p]));

    await flushTimers(); // 启动时立即跑一次 → throw → emit error
    expect(errors).toHaveLength(1);
    expect(changes).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    await flushTimers();
    expect(changes).toHaveLength(1);

    d.dispose();
  });

  it('dispose() removes timers and listeners', async () => {
    const listFn = vi.fn().mockResolvedValue([port('/dev/ttyUSB0')]);
    const d = new SerialDiscovery({ listFn });
    d.on('change', () => {});
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    d.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(d.listenerCount('change')).toBe(0);
  });
});
