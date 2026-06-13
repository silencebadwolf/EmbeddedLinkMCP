import { describe, expect, it } from 'vitest';
import { SerialSession } from '@/transports/serial/serial-session.js';
import type { SerialSessionConfig } from '@/shared/types.js';
import { createMockSerialPortFactory } from '../../fixtures/mock-serialport.js';

const baseConfig: SerialSessionConfig = {
  type: 'serial',
  port: '/dev/fake-tty',
  baudRate: 115200,
  mode: 'normal',
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('SerialSession', () => {
  it('exposes the configured serial mode as a stable readonly field', () => {
    const { factory } = createMockSerialPortFactory();
    const normal = new SerialSession({ id: 'sess_a', config: baseConfig, portFactory: factory });
    const terminal = new SerialSession({
      id: 'sess_b',
      config: { ...baseConfig, mode: 'terminal' },
      portFactory: factory,
    });
    expect(normal.mode).toBe('normal');
    expect(terminal.mode).toBe('terminal');
  });

  it('integrates with SessionBase: open → write audit → device data → close', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const session = new SerialSession({
      id: 'sess_int',
      config: baseConfig,
      portFactory: factory,
    });
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    await session.open();
    expect(session.state).toBe('open');
    expect(created).toHaveLength(1);

    // 人写入：audit 把字节追加到 transcript with origin=human
    await session.write(utf8('AT\r\n'), { origin: 'human' });
    const port = created[0]!;
    expect(port.writes).toHaveLength(1);
    expect(port.drainCalls).toBe(1);

    // 设备入站：origin=device
    port.pushIncoming(Buffer.from('OK\r\n'));

    const dataEvents = session.read(0).events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(2);
    expect(dataEvents[0]!.origin).toBe('human');
    expect(dataEvents[1]!.origin).toBe('device');

    await session.close();
    expect(session.state).toBe('closed');
    expect(states).toContain('opening');
    expect(states).toContain('open');
    expect(states).toContain('closing');
    expect(states).toContain('closed');
  });

  it('records errored state and releases the underlying port on transport-level error', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const session = new SerialSession({
      id: 'sess_err',
      config: baseConfig,
      portFactory: factory,
    });
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    await session.open();
    const port = created[0]!;
    port.pushError(new Error('framing'));

    // SessionBase.#onTransportError 调 fire-and-forget #transport.close()；
    // FakeSerialPort.close 用 queueMicrotask，需要多轮微任务才能 settle 完整链路。
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
    }

    expect(session.state).toBe('errored');
    expect(port.isOpen).toBe(false);
    expect(port.closeCalls).toBe(1);
    // errored 之后不应再走到 'closed' 状态
    expect(states).not.toContain('closed');
  });
});
