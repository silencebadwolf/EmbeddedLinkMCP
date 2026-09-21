import { describe, expect, it } from 'vitest';
import { SerialTransport } from '@linkterm/runtime/transports/serial/serial-transport';
import type { SerialSessionConfig } from '@/shared/types.js';
import {
  createMockSerialPortFactory,
} from '../../../../tests/fixtures/mock-serialport.js';

const baseConfig: SerialSessionConfig = {
  type: 'serial',
  port: '/dev/fake-tty',
  baudRate: 115200,
  mode: 'normal',
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('SerialTransport', () => {
  it('opens the underlying port with normalized 8N1 defaults', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    expect(created).toHaveLength(1);
    expect(created[0]!.options).toMatchObject({
      path: '/dev/fake-tty',
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      xon: false,
      xoff: false,
      autoOpen: false,
    });
    expect(transport.isOpen()).toBe(true);
  });

  it('passes through user-supplied wire parameters', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({
      config: { ...baseConfig, dataBits: 7, stopBits: 2, parity: 'even', rtscts: true },
      portFactory: factory,
    });
    await transport.open();
    expect(created[0]!.options).toMatchObject({
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
      rtscts: true,
    });
  });

  it('rejects open() with the underlying error and does not retain a half-initialized port', async () => {
    const failure = new Error('cannot open device');
    const { factory, created } = createMockSerialPortFactory({ failOnOpen: failure });
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await expect(transport.open()).rejects.toBe(failure);
    expect(transport.isOpen()).toBe(false);
    // 半初始化路径不应再次主动 close（serialport 在 open 失败时已自清理 fd）
    expect(created[0]!.closeCalls).toBe(0);
    // 后续 transport.close() 也不应触达 port —— 引用已被丢弃
    await transport.close();
    expect(created[0]!.closeCalls).toBe(0);
  });

  it('open() is idempotent', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    await transport.open();
    expect(created).toHaveLength(1);
  });

  it('write() resolves only after both write and drain succeed', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    await transport.write(utf8('AT\r\n'));
    const port = created[0]!;
    expect(port.writes).toHaveLength(1);
    expect(port.drainCalls).toBe(1);
    expect(Buffer.compare(port.writes[0]!, Buffer.from('AT\r\n'))).toBe(0);
  });

  it('write() propagates write-callback errors', async () => {
    const writeErr = new Error('serial write failed');
    const { factory } = createMockSerialPortFactory({ writeBehavior: 'fail', writeError: writeErr });
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    await expect(transport.write(utf8('hi'))).rejects.toBe(writeErr);
  });

  it('write() propagates drain-callback errors', async () => {
    const drainErr = new Error('drain failed');
    const { factory } = createMockSerialPortFactory({ drainBehavior: 'fail', drainError: drainErr });
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    await expect(transport.write(utf8('hi'))).rejects.toBe(drainErr);
  });

  it('write() throws when transport is not open', async () => {
    const { factory } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await expect(transport.write(utf8('x'))).rejects.toThrow(/not open/);
  });

  it('forwards underlying data events as Uint8Array chunks', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    const chunks: Uint8Array[] = [];
    transport.on('data', (c) => chunks.push(c));
    await transport.open();
    created[0]!.pushIncoming(Buffer.from('hello'));
    expect(chunks).toHaveLength(1);
    expect(Buffer.from(chunks[0]!).toString('utf-8')).toBe('hello');
  });

  it('forwards underlying error events without changing local close state', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    const errors: Error[] = [];
    transport.on('error', (e) => errors.push(e));
    await transport.open();
    const err = new Error('framing error');
    created[0]!.pushError(err);
    expect(errors).toEqual([err]);
    expect(transport.isOpen()).toBe(true);
  });

  it('underlying close (e.g. cable unplug) emits transport close once', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    created[0]!.triggerClose();
    expect(closes).toBe(1);
    expect(transport.isOpen()).toBe(false);
  });

  it('close() is idempotent and emits close exactly once when called twice', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    await transport.close();
    await transport.close(); // 第二次直接短路，不再调底层
    expect(closes).toBe(1);
    expect(created[0]!.closeCalls).toBe(1);
    expect(created[0]!.isOpen).toBe(false);
  });

  it('underlying disconnect followed by close() emits close exactly once and skips port.close', async () => {
    // 模拟生产路径：物理拔出 → 底层 'close' → SessionBase 调 transport.close()
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    created[0]!.triggerClose(); // 这条路径已 emit 一次 'close' 并把 #closed=true
    await transport.close(); // 应该短路，不再调 port.close()
    expect(closes).toBe(1);
    expect(created[0]!.closeCalls).toBe(0);
  });

  it('error event followed by close() (the SessionBase recovery path) does not double-emit close', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    let closes = 0;
    const errors: Error[] = [];
    transport.on('close', () => (closes += 1));
    transport.on('error', (e) => errors.push(e));
    await transport.open();
    created[0]!.pushError(new Error('framing'));
    // 真实场景：SessionBase.#onTransportError 会调 fire-and-forget transport.close()
    await transport.close();
    expect(errors).toHaveLength(1);
    expect(closes).toBe(1);
    expect(created[0]!.closeCalls).toBe(1);
  });

  it('close() before open() resolves and emits close (no port held)', async () => {
    const { factory, created } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.close();
    expect(closes).toBe(1);
    expect(created).toHaveLength(0);
  });

  it('does not allow re-opening after close', async () => {
    const { factory } = createMockSerialPortFactory();
    const transport = new SerialTransport({ config: baseConfig, portFactory: factory });
    await transport.open();
    await transport.close();
    await expect(transport.open()).rejects.toThrow(/has been closed/);
  });
});
