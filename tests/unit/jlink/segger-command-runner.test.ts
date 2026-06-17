import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JLinkAbortedError, JLinkOperationError } from '@/jlink/index.js';
import {
  buildDefaultCommanderCandidates,
  buildDefaultGdbServerCandidates,
  DefaultJLinkCommanderClient,
  DefaultJLinkGdbServerClient,
  NodeSeggerManagedProcessRunner,
  NodeSeggerProcessRunner,
  type SeggerGdbServerProcessHandle,
  type SeggerManagedProcessRequest,
  type SeggerManagedProcessRunner,
  type SeggerProcessRequest,
  type SeggerProcessResult,
} from '@/jlink/segger-command-runner.js';

class FakeProcessRunner {
  readonly requests: SeggerProcessRequest[] = [];
  result: SeggerProcessResult = { exitCode: 0, signal: null, stdout: 'Verify successful', stderr: '' };
  scriptContent = '';
  binaryContent = Buffer.alloc(0);
  scriptPath = '';
  binaryPath = '';

  async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    this.requests.push(request);
    const scriptIndex = request.args.indexOf('-CommandFile');
    expect(scriptIndex).toBeGreaterThanOrEqual(0);
    this.scriptPath = request.args[scriptIndex + 1]!;
    this.scriptContent = await readFile(this.scriptPath, 'utf-8');
    const pathMatch = this.scriptContent.match(/(?:loadbin|verifybin)\s+"([^"]+)"/i);
    if (pathMatch?.[1] !== undefined) {
      this.binaryPath = pathMatch[1];
      this.binaryContent = await readFile(this.binaryPath);
    } else {
      this.binaryPath = '';
      this.binaryContent = Buffer.alloc(0);
    }
    return this.result;
  }
}

class FakeManagedProcessHandle implements SeggerGdbServerProcessHandle {
  stopped = false;

  constructor(private readonly output: string) {}

  get outputTail(): string {
    return this.output;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

class FakeManagedProcessRunner implements SeggerManagedProcessRunner {
  readonly requests: SeggerManagedProcessRequest[] = [];
  handle = new FakeManagedProcessHandle('Listening on TCP/IP port 2331');
  failWith: Error | undefined;

  async start(request: SeggerManagedProcessRequest): Promise<SeggerGdbServerProcessHandle> {
    this.requests.push(request);
    if (this.failWith !== undefined) throw this.failWith;
    return this.handle;
  }
}

class CommandAwareRegisterRunner extends FakeProcessRunner {
  async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    await super.run(request);
    if (this.scriptContent.includes('\nrreg pc\n')) {
      return { exitCode: 1, signal: null, stdout: 'Unknown command: rreg pc', stderr: '' };
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: 'R0 = 00000001, R1 = 00000002\nSP(R13)= 20001000\nPC = 08001234\n',
      stderr: '',
    };
  }
}

class ReadyPatternCheckingManagedRunner extends FakeManagedProcessRunner {
  readyOutput = 'SEGGER J-Link GDB Server V7.92\nGDB Server Listening port: 2331\n';

  override async start(request: SeggerManagedProcessRequest): Promise<SeggerGdbServerProcessHandle> {
    this.requests.push(request);
    if (!request.readyPattern.test(this.readyOutput)) {
      throw new JLinkAbortedError('J-Link GDB Server timed out after 1234ms');
    }
    return new FakeManagedProcessHandle(this.readyOutput);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('buildDefaultCommanderCandidates', () => {
  it('checks SEGGER J-Link under non-system Windows Program Files drives', () => {
    const candidates = buildDefaultCommanderCandidates('win32', {}, ['D:\\']);

    expect(candidates).toContain('D:\\Program Files\\SEGGER\\JLink\\JLink.exe');
    expect(candidates).toContain('D:\\Program Files (x86)\\SEGGER\\JLink\\JLink.exe');
  });
});

describe('buildDefaultGdbServerCandidates', () => {
  it('checks SEGGER J-Link GDB server under non-system Windows Program Files drives', () => {
    const candidates = buildDefaultGdbServerCandidates('win32', {}, ['D:\\']);

    expect(candidates).toContain('D:\\Program Files\\SEGGER\\JLink\\JLinkGDBServerCL.exe');
    expect(candidates).toContain('D:\\Program Files (x86)\\SEGGER\\JLink\\JLinkGDBServerCL.exe');
  });
});

describe('NodeSeggerProcessRunner', () => {
  it('includes captured output preview when a process times out', async () => {
    const runner = new NodeSeggerProcessRunner();

    await expect(
      runner.run({
        command: process.execPath,
        args: ['-e', "process.stdout.write('partial-output'); setInterval(() => {}, 1000);"],
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/partial-output/);
  });
});

describe('DefaultJLinkCommanderClient', () => {
  let root: string;
  let commanderPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-jlink-runner-test-'));
    commanderPath = path.join(root, process.platform === 'win32' ? 'JLink.exe' : 'JLinkExe');
    await writeFile(commanderPath, '');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not reject a configured target only because local SEGGER XML databases do not list it', async () => {
    const client = new DefaultJLinkCommanderClient({ commanderPath, tempRoot: root });

    const availability = client.checkAvailability('AT32F435VGT7');

    expect(availability).toMatchObject({
      available: true,
      commanderPath,
      target: 'AT32F435VGT7',
      targetSupported: false,
    });
    expect(availability.reason).toBeUndefined();
  });

  it('reports target supported when a SEGGER device database contains the target', async () => {
    await writeFile(path.join(root, 'JLinkDevices.xml'), '<Device>AT32F435VGT7</Device>');
    const client = new DefaultJLinkCommanderClient({ commanderPath, tempRoot: root });

    expect(client.checkAvailability('AT32F435VGT7')).toMatchObject({
      available: true,
      commanderPath,
      targetSupported: true,
    });
  });

  it('downloads raw binary through a generated J-Link command file and cleans temporary files', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({
      commanderPath,
      runner,
      tempRoot: root,
    });
    const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    const result = await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000, serialNumber: '123456789' },
      binary,
      { address: 0x08008000, verify: true },
    );

    expect(result).toEqual({ bytesWritten: 4, verified: true });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toMatchObject({
      command: commanderPath,
      timeoutMs: expect.any(Number),
      args: expect.arrayContaining([
        '-device',
        'AT32F435RGT7',
        '-if',
        'SWD',
        '-speed',
        '4000',
        '-SelectEmuBySN',
        '123456789',
        '-ExitOnError',
        '1',
        '-NoGui',
        '1',
        '-CommandFile',
      ]),
    });
    expect(runner.requests[0]!.timeoutMs).toBeLessThanOrEqual(30_000);
    expect(runner.scriptContent).toContain('device AT32F435RGT7');
    expect(runner.scriptContent).toContain('si SWD');
    expect(runner.scriptContent).toContain('speed 4000');
    expect(runner.scriptContent).toContain('connect');
    expect(runner.scriptContent).toContain('loadbin');
    expect(runner.scriptContent).toContain('verifybin');
    expect(runner.scriptContent).toContain('0x08008000');
    expect(runner.binaryContent).toEqual(binary);
    expect(await exists(runner.scriptPath)).toBe(false);
    expect(await exists(runner.binaryPath)).toBe(false);
  });

  it('resets and runs the CPU through a generated J-Link command file', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Resetting target\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.reset({ target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 }, { halt: false }),
    ).resolves.toBeUndefined();

    expect(runner.requests).toHaveLength(1);
    expect(runner.scriptContent).toContain('device AT32F435RGT7');
    expect(runner.scriptContent).toContain('connect');
    expect(runner.scriptContent).toContain('\nr\n');
    expect(runner.scriptContent).toContain('\ng\n');
    expect(runner.scriptContent).not.toContain('\nh\n');
    expect(runner.binaryContent).toEqual(Buffer.alloc(0));
    expect(await exists(runner.scriptPath)).toBe(false);
  });

  it('reads, lists, and writes registers through generated J-Link command files', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'R0 = 00000001, R1 = 00000002\nSP(R13)= 20001000\nPC = 08001234\n',
      stderr: '',
    };
    await expect(client.listRegisters({ target: 'AT32F435RGT7' })).resolves.toEqual([
      { name: 'r0', value: 0x1 },
      { name: 'r1', value: 0x2 },
      { name: 'sp', value: 0x20001000 },
      { name: 'pc', value: 0x08001234 },
    ]);
    expect(runner.scriptContent).toContain('\nh\n');
    expect(runner.scriptContent).toContain('\nregs\n');

    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'PC = 08001234\n',
      stderr: '',
    };
    await expect(client.readRegister({ target: 'AT32F435RGT7' }, 'pc')).resolves.toEqual({
      name: 'pc',
      value: 0x08001234,
    });
    expect(runner.scriptContent).toContain('\nh\n');
    expect(runner.scriptContent).toContain('\nregs\n');

    await expect(client.writeRegister({ target: 'AT32F435RGT7' }, 'r0', 0x1234)).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nh\n');
    expect(runner.scriptContent).toContain('\nwreg r0, 0x00001234\n');
  });

  it('reads one register from regs output instead of direct rreg', async () => {
    const runner = new CommandAwareRegisterRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(client.readRegister({ target: 'AT32F435RGT7' }, 'pc')).resolves.toEqual({
      name: 'pc',
      value: 0x08001234,
    });

    expect(runner.requests).toHaveLength(1);
    expect(runner.scriptContent).toContain('\nh\n');
    expect(runner.scriptContent).toContain('\nregs\n');
    expect(runner.scriptContent).not.toContain('\nrreg pc\n');
  });

  it('reads and writes memory through generated J-Link command files', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: '20000000 = 12 34 AB CD                                      .4..\n',
      stderr: '',
    };
    await expect(client.readMemory({ target: 'AT32F435RGT7' }, { address: 0x20000000, length: 4 })).resolves.toEqual(
      Buffer.from([0x12, 0x34, 0xab, 0xcd]),
    );
    expect(runner.scriptContent).toContain('\nmem 0x20000000, 4\n');

    await expect(
      client.writeMemory({ target: 'AT32F435RGT7' }, 0x20000000, Buffer.from([0xde, 0xad])),
    ).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nw1 0x20000000, 0xde\n');
    expect(runner.scriptContent).toContain('\nw1 0x20000001, 0xad\n');
  });

  it('sets and clears breakpoints through generated J-Link command files', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(client.setBreakpoint({ target: 'AT32F435RGT7' }, 0x08001234, 'hw')).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nSetBP 0x08001234\n');

    await expect(client.clearBreakpoint({ target: 'AT32F435RGT7' }, 0x08001234)).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nClrBP 0x08001234\n');
  });

  it('erases and writes flash through generated J-Link command files', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });
    const binary = Buffer.from([0xde, 0xad]);

    await expect(client.eraseFlash({ target: 'AT32F435RGT7' }, { address: 0x08008000, length: 4096 })).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nerase 0x08008000, 0x08008fff\n');

    await expect(client.writeFlash({ target: 'AT32F435RGT7' }, 0x08008000, binary)).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nloadbin');
    expect(runner.scriptContent).toContain('0x08008000');
    expect(runner.binaryContent).toEqual(binary);
  });

  it('halts, runs, and steps through generated J-Link command files', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(client.halt({ target: 'AT32F435RGT7' })).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nh\n');

    await expect(client.run({ target: 'AT32F435RGT7' })).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\ng\n');

    await expect(client.step({ target: 'AT32F435RGT7' })).resolves.toBeUndefined();
    expect(runner.scriptContent).toContain('\nh\n');
    expect(runner.scriptContent).toContain('\ns\n');
  });

  it('returns mismatch address for failed verify output', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 1,
      signal: null,
      stdout: 'Verify failed @ address 0x08008010',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    const result = await client.verify(
      { target: 'AT32F435RGT7' },
      Buffer.from([0xaa, 0xbb]),
      { address: 0x08008000 },
    );

    expect(result).toEqual({ ok: false, mismatchAt: 0x08008010 });
    expect(runner.scriptContent).toContain('verifybin');
    expect(runner.scriptContent).not.toContain('loadbin');
  });

  it('maps command failures to sanitized JLinkOperationError', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 1,
      signal: null,
      stdout: 'S/N: 123456789\nFailed to connect to target',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.download(
        { target: 'AT32F435RGT7', serialNumber: '123456789' },
        Buffer.from([0x00]),
        { address: 0x08008000, verify: false },
      ),
    ).rejects.toBeInstanceOf(JLinkOperationError);

    try {
      await client.download(
        { target: 'AT32F435RGT7', serialNumber: '123456789' },
        Buffer.from([0x00]),
        { address: 0x08008000, verify: false },
      );
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('123456789');
    }
  });

  it('rejects an untrusted relative commander path without running a process', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath: 'JLink.exe', runner, tempRoot: root });

    await expect(
      client.verify(
        { target: 'AT32F435RGT7' },
        Buffer.from([0x00]),
        { address: 0x08008000 },
      ),
    ).rejects.toBeInstanceOf(JLinkOperationError);
    expect(runner.requests).toHaveLength(0);
  });

  it('honors a pre-aborted signal before creating files or running a process', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.download(
        { target: 'AT32F435RGT7' },
        Buffer.from([0x00]),
        { address: 0x08008000, verify: false },
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(JLinkAbortedError);
    expect(runner.requests).toHaveLength(0);
  });
});

describe('DefaultJLinkGdbServerClient', () => {
  let root: string;
  let gdbServerPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-jlink-gdb-test-'));
    gdbServerPath = path.join(root, process.platform === 'win32' ? 'JLinkGDBServerCL.exe' : 'JLinkGDBServerCLExe');
    await writeFile(gdbServerPath, '');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not reject GDB server startup only because local SEGGER XML databases do not list the target', () => {
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath });

    const availability = client.checkAvailability('AT32F435VGT7');

    expect(availability).toMatchObject({
      available: true,
      gdbServerPath,
      target: 'AT32F435VGT7',
      targetSupported: false,
    });
    expect(availability.reason).toBeUndefined();
  });

  it('starts a localhost GDB server with trusted executable args and captures output tail', async () => {
    await writeFile(path.join(root, 'JLinkDevices.xml'), '<Device>AT32F435RGT7</Device>');
    const runner = new FakeManagedProcessRunner();
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath, runner, defaultTimeoutMs: 1234 });

    const session = await client.start(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000, serialNumber: '123456789' },
      { host: '127.0.0.1', port: 2331 },
    );

    expect(session).toMatchObject({ host: '127.0.0.1', port: 2331, outputTail: 'Listening on TCP/IP port 2331' });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toMatchObject({
      command: gdbServerPath,
      timeoutMs: 1234,
      args: expect.arrayContaining([
        '-device',
        'AT32F435RGT7',
        '-if',
        'SWD',
        '-speed',
        '4000',
        '-port',
        '2331',
        '-localhostonly',
        '1',
        '-select',
        'USB=123456789',
      ]),
    });
  });

  it('treats SEGGER V7.92 silent listening port output as GDB server ready', async () => {
    const runner = new ReadyPatternCheckingManagedRunner();
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath, runner, defaultTimeoutMs: 1234 });

    const session = await client.start(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      { host: '127.0.0.1', port: 2331 },
    );

    expect(session).toMatchObject({
      host: '127.0.0.1',
      port: 2331,
      outputTail: expect.stringContaining('GDB Server Listening port: 2331'),
    });
  });

  it('sanitizes serial numbers from GDB server startup failures', async () => {
    const runner = new FakeManagedProcessRunner();
    runner.failWith = new JLinkAbortedError('Timed out; output preview: S/N: 123456789');
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath, runner });

    await expect(
      client.start({ target: 'AT32F435RGT7', serialNumber: '123456789' }, { port: 2331 }),
    ).rejects.toThrow(/\[redacted\]/);
    await expect(
      client.start({ target: 'AT32F435RGT7', serialNumber: '123456789' }, { port: 2331 }),
    ).rejects.not.toThrow(/123456789/);
  });
});

describe('NodeSeggerManagedProcessRunner', () => {
  it('resolves when readiness output appears and stop terminates the process', async () => {
    const runner = new NodeSeggerManagedProcessRunner();

    const handle = await runner.start({
      command: process.execPath,
      args: ['-e', "process.stdout.write('Waiting for GDB connection'); setInterval(() => {}, 1000);"],
      readyPattern: /Waiting for GDB connection/,
      processName: 'test-gdb-server',
      timeoutMs: 1000,
    });

    expect(handle.outputTail).toContain('Waiting for GDB connection');
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('reports external abort while waiting for readiness as aborted', async () => {
    const runner = new NodeSeggerManagedProcessRunner();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);

    try {
      await expect(
        runner.start({
          command: process.execPath,
          args: ['-e', "process.stdout.write('started'); setInterval(() => {}, 1000);"],
          readyPattern: /never-ready/,
          processName: 'test-gdb-server',
          timeoutMs: 1000,
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(JLinkAbortedError);
    } finally {
      clearTimeout(timer);
    }
  });

  it('includes sanitized output preview when readiness times out', async () => {
    const runner = new NodeSeggerManagedProcessRunner();

    await expect(
      runner.start({
        command: process.execPath,
        args: ['-e', "process.stdout.write('S/N: 123456789 partial-output'); setInterval(() => {}, 1000);"],
        readyPattern: /never-ready/,
        processName: 'test-gdb-server',
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/S\/N: \[redacted\].*partial-output/);
  });
});
