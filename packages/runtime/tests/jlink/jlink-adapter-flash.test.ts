import { describe, expect, it } from 'vitest';
import {
  JLinkAbortedError,
  JLinkAdapter,
  JLinkInvalidStateError,
  JLinkOperationError,
  ProbeBusyError,
  ProbeNotFoundError,
} from '@linkterm/runtime/jlink/index';
import type { ProbeConnectOptions } from '@linkterm/runtime/jlink/index';
import type {
  CommanderProbeContext,
  JLinkCommanderClient,
  JLinkGdbServerClient,
  JLinkGdbServerSession,
  JLinkRttClient,
  JLinkRttConnectOptions,
  JLinkRttSession,
} from '@linkterm/runtime/jlink/segger-command-runner';

interface CommanderCall {
  probe: CommanderProbeContext;
  binary: Buffer;
  opts: { address: number; verify?: boolean };
}

interface ResetCall {
  probe: CommanderProbeContext;
  opts?: { halt?: boolean };
}

interface CpuControlCall {
  probe: CommanderProbeContext;
}

interface RegisterReadCall {
  probe: CommanderProbeContext;
  name: string;
}

interface RegisterWriteCall {
  probe: CommanderProbeContext;
  name: string;
  value: number;
}

interface MemoryReadCall {
  probe: CommanderProbeContext;
  range: { address: number; length: number };
}

interface MemoryWriteCall {
  probe: CommanderProbeContext;
  address: number;
  data: Buffer;
}

interface BreakpointSetCall {
  probe: CommanderProbeContext;
  address: number;
  kind?: 'sw' | 'hw';
}

interface BreakpointClearCall {
  probe: CommanderProbeContext;
  address: number;
}

interface FlashEraseCall {
  probe: CommanderProbeContext;
  opts?: { address?: number; length?: number };
}

interface FlashWriteCall {
  probe: CommanderProbeContext;
  address: number;
  data: Buffer;
}

class FakeCommander implements JLinkCommanderClient {
  readonly connectTargetCalls: CommanderProbeContext[] = [];
  readonly downloadCalls: CommanderCall[] = [];
  readonly verifyCalls: CommanderCall[] = [];
  readonly resetCalls: ResetCall[] = [];
  readonly haltCalls: CpuControlCall[] = [];
  readonly runCalls: CpuControlCall[] = [];
  readonly stepCalls: CpuControlCall[] = [];
  readonly registerReadCalls: RegisterReadCall[] = [];
  readonly registerWriteCalls: RegisterWriteCall[] = [];
  readonly registerListCalls: CpuControlCall[] = [];
  readonly memoryReadCalls: MemoryReadCall[] = [];
  readonly memoryWriteCalls: MemoryWriteCall[] = [];
  readonly breakpointSetCalls: BreakpointSetCall[] = [];
  readonly breakpointClearCalls: BreakpointClearCall[] = [];
  readonly flashEraseCalls: FlashEraseCall[] = [];
  readonly flashWriteCalls: FlashWriteCall[] = [];
  registerListResult: Array<{ name: string; value: number }> = [
    { name: 'r0', value: 0x1 },
    { name: 'pc', value: 0x08001234 },
  ];
  memoryReadResult: Buffer | undefined;
  clearBreakpointError: Error | undefined;
  downloadResult: { bytesWritten: number; verified: boolean } | Promise<{ bytesWritten: number; verified: boolean }> = {
    bytesWritten: 0,
    verified: false,
  };
  verifyResult: { ok: boolean; mismatchAt?: number } = { ok: true };

  async connectTarget(probe: CommanderProbeContext, _signal?: AbortSignal): Promise<void> {
    this.connectTargetCalls.push(probe);
  }

  async download(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: { address: number; verify?: boolean },
    _signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    this.downloadCalls.push({ probe, binary, opts });
    return this.downloadResult;
  }

  async verify(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: { address: number },
    _signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    this.verifyCalls.push({ probe, binary, opts });
    return this.verifyResult;
  }

  async reset(probe: CommanderProbeContext, opts?: { halt?: boolean }, _signal?: AbortSignal): Promise<void> {
    this.resetCalls.push({ probe, opts });
  }

  async halt(probe: CommanderProbeContext, _signal?: AbortSignal): Promise<void> {
    this.haltCalls.push({ probe });
  }

  async run(probe: CommanderProbeContext, _signal?: AbortSignal): Promise<void> {
    this.runCalls.push({ probe });
  }

  async step(probe: CommanderProbeContext, _signal?: AbortSignal): Promise<void> {
    this.stepCalls.push({ probe });
  }

  async readRegister(probe: CommanderProbeContext, name: string, _signal?: AbortSignal): Promise<{ name: string; value: number }> {
    this.registerReadCalls.push({ probe, name });
    return { name, value: 0x08001234 };
  }

  async writeRegister(probe: CommanderProbeContext, name: string, value: number, _signal?: AbortSignal): Promise<void> {
    this.registerWriteCalls.push({ probe, name, value });
  }

  async listRegisters(probe: CommanderProbeContext, _signal?: AbortSignal): Promise<Array<{ name: string; value: number }>> {
    this.registerListCalls.push({ probe });
    return this.registerListResult;
  }

  async readMemory(probe: CommanderProbeContext, range: { address: number; length: number }, _signal?: AbortSignal): Promise<Buffer> {
    this.memoryReadCalls.push({ probe, range });
    return (this.memoryReadResult ?? Buffer.from([0x12, 0x34, 0xab, 0xcd])).subarray(0, range.length);
  }

  async writeMemory(probe: CommanderProbeContext, address: number, data: Buffer, _signal?: AbortSignal): Promise<void> {
    this.memoryWriteCalls.push({ probe, address, data });
  }
  async setBreakpoint(probe: CommanderProbeContext, address: number, kind?: 'sw' | 'hw'): Promise<void> {
    this.breakpointSetCalls.push({ probe, address, kind });
  }

  async clearBreakpoint(probe: CommanderProbeContext, address: number): Promise<void> {
    this.breakpointClearCalls.push({ probe, address });
    if (this.clearBreakpointError !== undefined) throw this.clearBreakpointError;
  }

  async eraseFlash(probe: CommanderProbeContext, opts?: { address?: number; length?: number }): Promise<void> {
    this.flashEraseCalls.push({ probe, opts });
  }

  async writeFlash(probe: CommanderProbeContext, address: number, data: Buffer): Promise<void> {
    this.flashWriteCalls.push({ probe, address, data });
  }
}

class FakeGdbServer implements JLinkGdbServerClient {
  readonly startCalls: Array<{ probe: CommanderProbeContext; opts?: { host?: string; port?: number } }> = [];
  stopCallCount = 0;

  async start(
    probe: CommanderProbeContext,
    opts?: { host?: string; port?: number },
    _signal?: AbortSignal,
  ): Promise<JLinkGdbServerSession> {
    this.startCalls.push({ probe, opts });
    return {
      host: opts?.host ?? '127.0.0.1',
      port: opts?.port ?? 2331,
      rttTelnetPort: 19021,
      outputTail: 'ready',
      stop: async () => {
        this.stopCallCount += 1;
      },
    };
  }
}

class FakeRttSession implements JLinkRttSession {
  readonly writeCalls: Array<{ channelIndex: number; data: Buffer }> = [];

  constructor(private buffer: Buffer) {}

  get channels() {
    return [{ index: 0, name: 'Terminal', direction: 'up' as const, bufferSize: 1024 }];
  }

  async read(channelIndex: number, maxBytes: number) {
    const data = this.buffer.subarray(0, maxBytes);
    this.buffer = this.buffer.subarray(data.byteLength);
    return { data, channelIndex, truncated: this.buffer.byteLength > 0 };
  }

  async search(channelIndex: number, pattern: string, maxBytes: number) {
    const preview = this.buffer.subarray(0, maxBytes);
    return { matchAt: preview.indexOf(pattern), preview };
  }

  async clear(_channelIndex: number): Promise<void> {
    this.buffer = Buffer.alloc(0);
  }

  async write(channelIndex: number, data: Buffer): Promise<void> {
    this.writeCalls.push({ channelIndex, data: Buffer.from(data) });
  }

  async close(): Promise<void> {
    this.buffer = Buffer.alloc(0);
  }
}

class FakeRttClient implements JLinkRttClient {
  readonly connectCalls: JLinkRttConnectOptions[] = [];
  session = new FakeRttSession(Buffer.from('hello-rtt'));
  failuresBeforeSuccess = 0;

  async connect(opts: JLinkRttConnectOptions): Promise<JLinkRttSession> {
    this.connectCalls.push(opts);
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new JLinkOperationError('Failed to connect to J-Link RTT telnet endpoint', {
        operation: 'rttConnect',
      });
    }
    return this.session;
  }
}

function createAdapter(commander: JLinkCommanderClient): JLinkAdapter {
  return new JLinkAdapter({ commander });
}

async function connect(adapter: JLinkAdapter, opts: ProbeConnectOptions = { target: 'AT32F435RGT7' }) {
  return adapter.probeConnect(opts);
}

describe('JLinkAdapter flash operations', () => {
  it('delegates flashDownload to the commander with probe context and returns the result', async () => {
    const commander = new FakeCommander();
    commander.downloadResult = { bytesWritten: 4, verified: true };
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, {
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
      serialNumber: '123456789',
    });
    const binary = Buffer.from([1, 2, 3, 4]);

    const result = await adapter.flashDownload(probe.probeId, binary, {
      address: 0x08008000,
      verify: true,
    });

    expect(result).toEqual({ bytesWritten: 4, verified: true });
    expect(commander.downloadCalls).toHaveLength(1);
    expect(commander.downloadCalls[0]).toMatchObject({
      probe: {
        target: 'AT32F435RGT7',
        interface: 'swd',
        speedKHz: 4000,
        serialNumber: '123456789',
      },
      opts: { address: 0x08008000, verify: true },
    });
    expect(commander.downloadCalls[0]!.binary).toEqual(binary);
  });

  it('performs an independent full-image verify after a verified flashDownload', async () => {
    const commander = new FakeCommander();
    commander.downloadResult = { bytesWritten: 4, verified: true };
    commander.verifyResult = { ok: true };
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);
    const binary = Buffer.from([1, 2, 3, 4]);

    const result = await adapter.flashDownload(probe.probeId, binary, {
      address: 0x08000000,
      verify: true,
    });

    expect(result).toEqual({ bytesWritten: 4, verified: true });
    expect(commander.verifyCalls).toHaveLength(1);
    expect(commander.verifyCalls[0]).toMatchObject({
      probe: { target: 'AT32F435RGT7' },
      opts: { address: 0x08000000 },
    });
    expect(commander.verifyCalls[0]!.binary).toEqual(binary);
  });

  it('rejects flashDownload when the independent full-image verify finds a mismatch', async () => {
    const commander = new FakeCommander();
    commander.downloadResult = { bytesWritten: 4, verified: true };
    commander.verifyResult = { ok: false, mismatchAt: 0x08000000 };
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(
      adapter.flashDownload(probe.probeId, Buffer.from([1, 2, 3, 4]), {
        address: 0x08000000,
        verify: true,
      }),
    ).rejects.toThrow(/0x08000000/);
  });

  it('requires an address for raw flashDownload input', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.flashDownload(probe.probeId, Buffer.from([1]))).rejects.toBeInstanceOf(
      JLinkInvalidStateError,
    );
    expect(commander.downloadCalls).toHaveLength(0);
  });

  it('delegates flashVerify and returns mismatch information', async () => {
    const commander = new FakeCommander();
    commander.verifyResult = { ok: false, mismatchAt: 0x08008010 };
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);
    const binary = Buffer.from([0xaa, 0xbb]);

    const result = await adapter.flashVerify(probe.probeId, binary, { address: 0x08008000 });

    expect(result).toEqual({ ok: false, mismatchAt: 0x08008010 });
    expect(commander.verifyCalls).toHaveLength(1);
    expect(commander.verifyCalls[0]).toMatchObject({
      probe: { target: 'AT32F435RGT7' },
      opts: { address: 0x08008000 },
    });
    expect(commander.verifyCalls[0]!.binary).toEqual(binary);
  });

  it('rejects concurrent operations on the same probe as busy', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    const first = adapter.flashDownload(probe.probeId, Buffer.from([1]), { address: 0x08008000 });
    await expect(adapter.flashVerify(probe.probeId, Buffer.from([1]), { address: 0x08008000 })).rejects.toBeInstanceOf(
      ProbeBusyError,
    );

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('serializes duplicate handles for the same physical probe serial number', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const firstProbe = await connect(adapter, { target: 'AT32F435RGT7', serialNumber: '123456789' });
    const duplicateProbe = await connect(adapter, { target: 'AT32F435RGT7', serialNumber: '123456789' });

    const first = adapter.flashDownload(firstProbe.probeId, Buffer.from([1]), { address: 0x08008000 });
    await expect(
      adapter.flashVerify(duplicateProbe.probeId, Buffer.from([1]), { address: 0x08008000 }),
    ).rejects.toBeInstanceOf(ProbeBusyError);

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('blocks explicit serial operations while an unqualified default probe selection is busy', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const defaultProbe = await connect(adapter);
    const serialProbe = await connect(adapter, { target: 'AT32F435RGT7', serialNumber: '123456789' });

    const first = adapter.flashDownload(defaultProbe.probeId, Buffer.from([1]), { address: 0x08008000 });
    await expect(adapter.flashVerify(serialProbe.probeId, Buffer.from([1]), { address: 0x08008000 })).rejects.toBeInstanceOf(
      ProbeBusyError,
    );
    await expect(adapter.probeDisconnect(serialProbe.probeId)).rejects.toBeInstanceOf(ProbeBusyError);

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('rejects changing the default probe target while that physical selection is busy', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const staleTargetProbe = await connect(adapter, { target: 'STM32H743II', interface: 'swd' });

    const first = adapter.flashDownload(staleTargetProbe.probeId, Buffer.from([1]), { address: 0x08000000 });
    await expect(adapter.probeConnect({ target: 'STM32H743ZI', interface: 'swd' })).rejects.toBeInstanceOf(
      ProbeBusyError,
    );

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('does not claim a busy normalized probe is reconnected without fresh target evidence', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, { target: 'STM32H743II', interface: 'swd' });

    const first = adapter.flashDownload(probe.probeId, Buffer.from([1]), { address: 0x08000000 });
    await expect(
      adapter.probeConnect({ target: 'STM32H743IIT6', interface: 'swd' }),
    ).rejects.toBeInstanceOf(ProbeBusyError);

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('blocks unqualified default probe selection while an explicit serial operation is busy', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const serialProbe = await connect(adapter, { target: 'AT32F435RGT7', serialNumber: '123456789' });
    const defaultProbe = await connect(adapter);

    const first = adapter.flashDownload(serialProbe.probeId, Buffer.from([1]), { address: 0x08008000 });
    await expect(adapter.flashVerify(defaultProbe.probeId, Buffer.from([1]), { address: 0x08008000 })).rejects.toBeInstanceOf(
      ProbeBusyError,
    );
    await expect(adapter.probeDisconnect(defaultProbe.probeId)).rejects.toBeInstanceOf(ProbeBusyError);

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('rejects disconnect while the physical probe is busy', async () => {
    let release!: () => void;
    const commander = new FakeCommander();
    commander.downloadResult = new Promise((resolve) => {
      release = () => resolve({ bytesWritten: 1, verified: false });
    });
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    const first = adapter.flashDownload(probe.probeId, Buffer.from([1]), { address: 0x08008000 });
    await expect(adapter.probeDisconnect(probe.probeId)).rejects.toBeInstanceOf(ProbeBusyError);

    release();
    await expect(first).resolves.toEqual({ bytesWritten: 1, verified: false });
  });

  it('honors pre-aborted flashDownload without calling the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.flashDownload(probe.probeId, Buffer.from([1]), { address: 0x08008000 }, controller.signal),
    ).rejects.toBeInstanceOf(JLinkAbortedError);
    expect(commander.downloadCalls).toHaveLength(0);
    await expect(adapter.flashVerify(probe.probeId, Buffer.from([1]), { address: 0x08008000 })).resolves.toEqual({ ok: true });
    expect(commander.verifyCalls).toHaveLength(1);
  });

  it('delegates flashErase to the commander with optional address range', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 });

    await expect(adapter.flashErase(probe.probeId, { address: 0x08008000, length: 4096 })).resolves.toBeUndefined();

    expect(commander.flashEraseCalls).toEqual([
      {
        probe: { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        opts: { address: 0x08008000, length: 4096 },
      },
    ]);
  });

  it('delegates flashWrite to the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);
    const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

    await expect(adapter.flashWrite(probe.probeId, 0x08008000, data)).resolves.toBeUndefined();

    expect(commander.flashWriteCalls).toHaveLength(1);
    expect(commander.flashWriteCalls[0]).toMatchObject({
      probe: { target: 'AT32F435RGT7' },
      address: 0x08008000,
    });
    expect(commander.flashWriteCalls[0]!.data).toEqual(data);
  });
});

describe('CPU control', () => {
  it('delegates cpuReset to the commander with probe context and halt option', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, {
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
      serialNumber: '123456789',
    });

    await expect(adapter.cpuReset(probe.probeId, { halt: false })).resolves.toBeUndefined();

    expect(commander.resetCalls).toHaveLength(1);
    expect(commander.resetCalls[0]).toMatchObject({
      probe: {
        target: 'AT32F435RGT7',
        interface: 'swd',
        speedKHz: 4000,
        serialNumber: '123456789',
      },
      opts: { halt: false },
    });
  });

  it('delegates cpuHalt to the commander with probe context', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, {
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
      serialNumber: '123456789',
    });

    await expect(adapter.cpuHalt(probe.probeId)).resolves.toBeUndefined();

    expect(commander.haltCalls).toHaveLength(1);
    expect(commander.haltCalls[0]).toEqual({
      probe: {
        target: 'AT32F435RGT7',
        interface: 'swd',
        speedKHz: 4000,
        serialNumber: '123456789',
      },
    });
  });

  it('delegates cpuRun to the commander with probe context', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.cpuRun(probe.probeId)).resolves.toBeUndefined();

    expect(commander.runCalls).toHaveLength(1);
    expect(commander.runCalls[0]).toEqual({
      probe: { target: 'AT32F435RGT7' },
    });
  });

  it('delegates cpuStep to the commander with probe context', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.cpuStep(probe.probeId)).resolves.toBeUndefined();

    expect(commander.stepCalls).toHaveLength(1);
    expect(commander.stepCalls[0]).toEqual({
      probe: { target: 'AT32F435RGT7' },
    });
  });
});

describe('Register operations', () => {
  it('delegates registerRead to the commander and returns the parsed value', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 });

    await expect(adapter.registerRead(probe.probeId, 'pc')).resolves.toEqual({
      name: 'pc',
      value: 0x08001234,
    });

    expect(commander.registerReadCalls).toEqual([
      { probe: { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 }, name: 'pc' },
    ]);
  });

  it('delegates registerWrite to the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.registerWrite(probe.probeId, 'r0', 0x1234)).resolves.toBeUndefined();

    expect(commander.registerWriteCalls).toEqual([
      { probe: { target: 'AT32F435RGT7' }, name: 'r0', value: 0x1234 },
    ]);
  });

  it('delegates registerList to the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.registerList(probe.probeId)).resolves.toEqual([
      { name: 'r0', value: 0x1 },
      { name: 'pc', value: 0x08001234 },
    ]);

    expect(commander.registerListCalls).toEqual([{ probe: { target: 'AT32F435RGT7' } }]);
  });
});

describe('Memory operations', () => {
  it('delegates memoryRead to the commander and returns bytes', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 });

    await expect(adapter.memoryRead(probe.probeId, { address: 0x20000000, length: 4 })).resolves.toEqual(
      Buffer.from([0x12, 0x34, 0xab, 0xcd]),
    );

    expect(commander.memoryReadCalls).toEqual([
      {
        probe: { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        range: { address: 0x20000000, length: 4 },
      },
    ]);
  });

  it('delegates memoryWrite to the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);
    const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

    await expect(adapter.memoryWrite(probe.probeId, 0x20000000, data)).resolves.toBeUndefined();

    expect(commander.memoryWriteCalls).toHaveLength(1);
    expect(commander.memoryWriteCalls[0]).toMatchObject({
      probe: { target: 'AT32F435RGT7' },
      address: 0x20000000,
    });
    expect(commander.memoryWriteCalls[0]!.data).toEqual(data);
  });
});

describe('Breakpoint operations', () => {
  it('sets breakpoints with per-probe ids and lists them', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter, { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 });

    await expect(adapter.breakpointSet(probe.probeId, 0x08001234, { kind: 'hw' })).resolves.toEqual({
      id: 1,
      address: 0x08001234,
      kind: 'hw',
      enabled: true,
    });
    await expect(adapter.breakpointSet(probe.probeId, 0x08005678)).resolves.toEqual({
      id: 2,
      address: 0x08005678,
      kind: 'sw',
      enabled: true,
    });

    await expect(adapter.breakpointList(probe.probeId)).resolves.toEqual([
      { id: 1, address: 0x08001234, kind: 'hw', enabled: true },
      { id: 2, address: 0x08005678, kind: 'sw', enabled: true },
    ]);
    expect(commander.breakpointSetCalls).toEqual([
      { probe: { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 }, address: 0x08001234, kind: 'hw' },
      { probe: { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 }, address: 0x08005678, kind: 'sw' },
    ]);
  });

  it('clears a known breakpoint id without removing unrelated breakpoints', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await adapter.breakpointSet(probe.probeId, 0x08001234, { kind: 'hw' });
    await adapter.breakpointSet(probe.probeId, 0x08005678, { kind: 'sw' });

    await expect(adapter.breakpointClear(probe.probeId, 1)).resolves.toBeUndefined();

    expect(commander.breakpointClearCalls).toEqual([{ probe: { target: 'AT32F435RGT7' }, address: 0x08001234 }]);
    await expect(adapter.breakpointList(probe.probeId)).resolves.toEqual([
      { id: 2, address: 0x08005678, kind: 'sw', enabled: true },
    ]);
  });

  it('rejects unknown breakpoint ids without touching the commander', async () => {
    const commander = new FakeCommander();
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.breakpointClear(probe.probeId, 99)).rejects.toBeInstanceOf(JLinkInvalidStateError);

    expect(commander.breakpointClearCalls).toHaveLength(0);
  });

  it('keeps the breakpoint ledger unchanged when target clear fails', async () => {
    const commander = new FakeCommander();
    commander.clearBreakpointError = new JLinkOperationError('clear failed', { operation: 'breakpointClear' });
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await adapter.breakpointSet(probe.probeId, 0x08001234, { kind: 'hw' });

    await expect(adapter.breakpointClear(probe.probeId, 1)).rejects.toBeInstanceOf(JLinkOperationError);
    await expect(adapter.breakpointList(probe.probeId)).resolves.toEqual([
      { id: 1, address: 0x08001234, kind: 'hw', enabled: true },
    ]);
  });
});

describe('RTT operations', () => {
  it('connects through the existing GDB server RTT endpoint and reads bytes', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId, { host: '127.0.0.1', port: 2331 });
    await expect(adapter.rttConnect(probe.probeId)).resolves.toEqual({
      channels: [{ index: 0, name: 'Terminal', direction: 'up', bufferSize: 1024 }],
    });
    expect(rttClient.connectCalls).toEqual([{ host: '127.0.0.1', port: 19021 }]);

    await expect(adapter.rttRead(probe.probeId, 0, 5)).resolves.toEqual({
      channelIndex: 0,
      data: Buffer.from('hello'),
      truncated: true,
    });
  });

  it('passes an explicit RTT control block address to the RTT transport client', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId, { host: '127.0.0.1', port: 2331 });
    await adapter.rttConnect(probe.probeId, { controlBlockAddress: 0x24005310 });

    expect(rttClient.connectCalls).toEqual([
      { host: '127.0.0.1', port: 19021, controlBlockAddress: 0x24005310 },
    ]);
  });

  it('waits for the GDB server RTT telnet endpoint before giving up', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    rttClient.failuresBeforeSuccess = 2;
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId, { host: '127.0.0.1', port: 2331 });
    await expect(adapter.rttConnect(probe.probeId)).resolves.toEqual({
      channels: [{ index: 0, name: 'Terminal', direction: 'up', bufferSize: 1024 }],
    });

    expect(rttClient.connectCalls).toEqual([
      { host: '127.0.0.1', port: 19021 },
      { host: '127.0.0.1', port: 19021 },
      { host: '127.0.0.1', port: 19021 },
    ]);
  });

  it('searches without consuming and clears buffered RTT data', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId);
    await adapter.rttConnect(probe.probeId);

    await expect(adapter.rttSearch(probe.probeId, 0, 'rtt', 32)).resolves.toEqual({
      matchAt: 6,
      preview: Buffer.from('hello-rtt'),
    });
    await expect(adapter.rttRead(probe.probeId, 0, 9)).resolves.toEqual({
      channelIndex: 0,
      data: Buffer.from('hello-rtt'),
      truncated: false,
    });

    rttClient.session = new FakeRttSession(Buffer.from('again'));
    await adapter.rttConnect(probe.probeId);
    await expect(adapter.rttClear(probe.probeId, 0)).resolves.toBeUndefined();
    await expect(adapter.rttRead(probe.probeId, 0, 16)).resolves.toEqual({
      channelIndex: 0,
      data: Buffer.alloc(0),
      truncated: false,
    });
  });

  it('writes bytes to the active RTT session', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId);
    await adapter.rttConnect(probe.probeId);
    await adapter.rttWrite(probe.probeId, 0, Buffer.from('help\r'));

    expect(rttClient.session.writeCalls).toEqual([
      { channelIndex: 0, data: Buffer.from('help\r') },
    ]);
  });

  it('rejects RTT read before connect', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const rttClient = new FakeRttClient();
    const adapter = new JLinkAdapter({ commander, gdbServer, rttClient });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await expect(adapter.rttRead(probe.probeId, 0, 16)).rejects.toBeInstanceOf(JLinkInvalidStateError);
  });
});

describe('Snapshot and crash diagnosis', () => {
  it('captures registers and requested memory ranges', async () => {
    const commander = new FakeCommander();
    commander.registerListResult = [
      { name: 'pc', value: 0x08001234 },
      { name: 'sp', value: 0x20001000 },
      { name: 'r0', value: 0x1 },
    ];
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.snapshotCapture(probe.probeId, [{ address: 0x20000000, length: 4 }])).resolves.toMatchObject({
      pc: 0x08001234,
      sp: 0x20001000,
      registers: commander.registerListResult,
      memorySnippets: [{ address: 0x20000000, data: Buffer.from([0x12, 0x34, 0xab, 0xcd]) }],
      capturedAt: expect.any(Number),
    });
    expect(commander.registerListCalls).toEqual([{ probe: { target: 'AT32F435RGT7' } }]);
    expect(commander.memoryReadCalls).toEqual([
      { probe: { target: 'AT32F435RGT7' }, range: { address: 0x20000000, length: 4 } },
    ]);
  });

  it('decodes Cortex-M hardfault registers', async () => {
    const commander = new FakeCommander();
    commander.registerListResult = [
      { name: 'pc', value: 0x08001234 },
      { name: 'lr', value: 0xfffffff9 },
      { name: 'sp', value: 0x20001000 },
    ];
    commander.memoryReadResult = Buffer.from([
      0x00, 0x00, 0x00, 0x02,
      0x00, 0x00, 0x00, 0x40,
      0x00, 0x00, 0x00, 0x20,
      0x00, 0x00, 0x00, 0x20,
    ]);
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.crashDiagnose(probe.probeId)).resolves.toMatchObject({
      fault: 'hardfault',
      pc: 0x08001234,
      lr: 0xfffffff9,
      sp: 0x20001000,
      reason: expect.stringContaining('FORCED'),
      stackTrace: [{ pc: 0x08001234 }],
    });
  });

  it('returns unknown when no Cortex-M fault bit is present', async () => {
    const commander = new FakeCommander();
    commander.registerListResult = [
      { name: 'pc', value: 0x08001234 },
      { name: 'lr', value: 0xfffffff9 },
      { name: 'sp', value: 0x20001000 },
    ];
    commander.memoryReadResult = Buffer.alloc(16, 0);
    const adapter = createAdapter(commander);
    const probe = await connect(adapter);

    await expect(adapter.crashDiagnose(probe.probeId)).resolves.toMatchObject({
      fault: 'unknown',
      pc: 0x08001234,
      lr: 0xfffffff9,
      sp: 0x20001000,
      reason: expect.stringContaining('No active Cortex-M fault'),
    });
  });
});

describe('GDB server lifecycle', () => {
  it('does not run Commander revalidation while a managed debug session owns the probe', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const adapter = new JLinkAdapter({ commander, gdbServer });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });
    await adapter.gdbServerStart(probe.probeId, { port: 2331 });

    await expect(adapter.probeStatus(probe.probeId)).rejects.toBeInstanceOf(ProbeBusyError);
    await expect(adapter.probeConnect({ target: 'AT32F435RGT7' })).rejects.toBeInstanceOf(
      ProbeBusyError,
    );
    expect(commander.connectTargetCalls).toHaveLength(1);

    await adapter.gdbServerStop(probe.probeId);
    await expect(adapter.probeStatus(probe.probeId)).resolves.toMatchObject({ connected: true });
    expect(commander.connectTargetCalls).toHaveLength(2);
  });

  it('starts and stops a GDB server through the injected client', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const adapter = new JLinkAdapter({ commander, gdbServer });
    const probe = await adapter.probeConnect({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
      serialNumber: '123456789',
    });

    await expect(adapter.gdbServerStart(probe.probeId, { host: '127.0.0.1', port: 2331 })).resolves.toEqual({
      host: '127.0.0.1',
      port: 2331,
    });
    expect(gdbServer.startCalls).toHaveLength(1);
    expect(gdbServer.startCalls[0]).toMatchObject({
      probe: {
        target: 'AT32F435RGT7',
        interface: 'swd',
        speedKHz: 4000,
        serialNumber: '123456789',
      },
      opts: { host: '127.0.0.1', port: 2331 },
    });

    await adapter.gdbServerStop(probe.probeId);
    expect(gdbServer.stopCallCount).toBe(1);
  });

  it('returns the existing handle for repeated starts on the same endpoint', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const adapter = new JLinkAdapter({ commander, gdbServer });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId, { port: 2331 });
    await expect(adapter.gdbServerStart(probe.probeId, { port: 2331 })).resolves.toEqual({
      host: '127.0.0.1',
      port: 2331,
    });
    expect(gdbServer.startCalls).toHaveLength(1);
  });

  it('stops an owned GDB server when disconnecting the probe', async () => {
    const commander = new FakeCommander();
    const gdbServer = new FakeGdbServer();
    const adapter = new JLinkAdapter({ commander, gdbServer });
    const probe = await adapter.probeConnect({ target: 'AT32F435RGT7' });

    await adapter.gdbServerStart(probe.probeId, { port: 2331 });
    await adapter.probeDisconnect(probe.probeId);

    expect(gdbServer.stopCallCount).toBe(1);
    await expect(adapter.probeStatus(probe.probeId)).rejects.toBeInstanceOf(ProbeNotFoundError);
  });
});
