import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { JLinkAbortedError, JLinkInvalidStateError, JLinkOperationError } from '@/jlink/index.js';
import {
  buildDefaultCommanderCandidates,
  buildDefaultGdbServerCandidates,
  DefaultJLinkCommanderClient,
  DefaultJLinkGdbServerClient,
  NetJLinkRttClient,
  NodeSeggerManagedProcessRunner,
  NodeSeggerProcessRunner,
  type SeggerGdbServerProcessHandle,
  type SeggerManagedProcessRequest,
  type SeggerManagedProcessRunner,
  type SeggerProcessRequest,
  type SeggerProcessResult,
} from '@/jlink/segger-command-runner.js';
import type { FlashProgressUpdate } from '@/jlink/types.js';

class FakeProcessRunner {
  readonly requests: SeggerProcessRequest[] = [];
  readonly observedScriptPaths: string[] = [];
  readonly observedBinaryPaths: string[] = [];
  readonly scripts: string[] = [];
  readonly binaries: Buffer[] = [];
  result: SeggerProcessResult = { exitCode: 0, signal: null, stdout: 'Verify successful', stderr: '' };
  writeReadback = true;
  scriptContent = '';
  binaryContent = Buffer.alloc(0);
  scriptPath = '';
  binaryPath = '';

  async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    this.requests.push(request);
    const scriptIndex = request.args.indexOf('-CommandFile');
    expect(scriptIndex).toBeGreaterThanOrEqual(0);
    const scriptPath = request.args[scriptIndex + 1]!;
    this.scriptPath = scriptPath;
    this.observedScriptPaths.push(scriptPath);
    const scriptContent = await readFile(scriptPath, 'utf-8');
    this.scriptContent = scriptContent;
    this.scripts.push(scriptContent);
    const pathMatch = scriptContent.match(/(?:loadbin|verifybin)\s+"([^"]+)"/i);
    let binaryContent = Buffer.alloc(0);
    if (pathMatch?.[1] !== undefined) {
      this.binaryPath = pathMatch[1];
      this.observedBinaryPaths.push(this.binaryPath);
      binaryContent = await readFile(this.binaryPath);
      this.binaryContent = binaryContent;
    } else {
      this.binaryPath = '';
      this.binaryContent = Buffer.alloc(0);
    }
    this.binaries.push(Buffer.from(binaryContent));
    const readbackMatch = scriptContent.match(/savebin\s+"([^"]+)"/i);
    if (this.writeReadback && readbackMatch?.[1] !== undefined) {
      await writeFile(readbackMatch[1], binaryContent);
    }
    return this.result;
  }
}

class CapturingProcessRunner extends FakeProcessRunner {
  override async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    return super.run(request);
  }
}

class StreamingOutputProcessRunner extends FakeProcessRunner {
  constructor(private readonly chunksByRun: string[][]) {
    super();
  }

  override async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    const result = await super.run(request);
    const chunks = this.chunksByRun[this.requests.length - 1] ?? [];
    for (const chunk of chunks) {
      request.onOutput?.({ stream: 'stdout', chunk });
    }
    return result;
  }
}

class VerifyReadbackMismatchRunner extends FakeProcessRunner {
  override async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    await super.run(request);
    const readbackMatch = this.scriptContent.match(/savebin\s+"([^"]+)"/i);
    if (readbackMatch?.[1] !== undefined) {
      await writeFile(readbackMatch[1], Buffer.from([0xaa, 0x00]));
    }
    return { exitCode: 0, signal: null, stdout: 'Verify successful\n', stderr: '' };
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

  it('bounds captured stdout and stderr independently', async () => {
    const runner = new NodeSeggerProcessRunner();

    const result = await runner.run({
      command: process.execPath,
      args: ['-e', "process.stdout.write('abcdef'); process.stderr.write('ghijkl');"],
      timeoutMs: 1000,
      maxOutputBytes: 3,
    });

    expect(result.stdout).toBe('abc');
    expect(result.stderr).toBe('ghi');
    expect(result.truncated).toBe(true);
  });

  it('uses shell-disabled child_process spawning', async () => {
    const source = await readFile(path.resolve('src/jlink/segger-command-runner.ts'), 'utf-8');

    expect(source).toContain('shell: false');
    expect(source).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });

  it('terminates child process descendants when a command times out', async () => {
    const runner = new NodeSeggerProcessRunner();
    const marker = `linkterm-runner-child-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      await expect(
        runner.run({
          command: process.execPath,
          args: [
            '-e',
            [
              "const { spawn } = require('node:child_process');",
              `spawn(process.execPath, ['-e', "process.title='${marker}'; setInterval(() => {}, 1000);"], { stdio: 'ignore', detached: false });`,
              'setInterval(() => {}, 1000);',
            ].join(''),
          ],
          timeoutMs: 500,
        }),
      ).rejects.toBeInstanceOf(JLinkAbortedError);

      expect(listProcessesByCommandLine(marker)).toEqual([]);
    } finally {
      killProcessesByCommandLine(marker);
    }
  }, 15_000);
});

function listProcessesByCommandLine(marker: string): string[] {
  if (process.platform === 'win32') {
    const escaped = marker.replace(/'/g, "''");
    const output = execFileSync(
      windowsPowerShellPath(),
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf-8', windowsHide: true },
    );
    return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  }
  let output = '';
  try {
    output = execFileSync('pgrep', ['-f', marker], { encoding: 'utf-8' });
  } catch {
    return [];
  }
  return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).filter((pid) => pid !== String(process.pid));
}

function killProcessesByCommandLine(marker: string): void {
  if (process.platform === 'win32') {
    const escaped = marker.replace(/'/g, "''");
    execFileSync(
      windowsPowerShellPath(),
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { encoding: 'utf-8', windowsHide: true },
    );
    return;
  }
  try {
    execFileSync('pkill', ['-f', marker], { encoding: 'utf-8' });
  } catch {
    // No matching process is fine.
  }
}

class TimeoutOnCommanderRunRunner extends FakeProcessRunner {
  override async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    await super.run(request);
    throw new JLinkAbortedError('J-Link Commander timed out after 30000ms');
  }
}

function windowsPowerShellPath(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

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

  it('keeps Commander available when local SEGGER XML databases do not list a target', async () => {
    const client = new DefaultJLinkCommanderClient({ commanderPath, tempRoot: root });

    const availability = client.checkAvailability('AT32F435VGT7');

    expect(availability).toMatchObject({
      available: true,
      commanderPath,
      target: 'AT32F435VGT7',
      targetSupported: false,
    });
    expect(availability.message).toContain('not listed');
  });

  it('reports target supported when a SEGGER device database contains the target', async () => {
    await writeFile(path.join(root, 'JLinkDevices.xml'), '<Device><ChipInfo Name="AT32F435VGT7"/></Device>');
    const client = new DefaultJLinkCommanderClient({ commanderPath, tempRoot: root });

    expect(client.checkAvailability('AT32F435VGT7')).toMatchObject({
      available: true,
      commanderPath,
      targetSupported: true,
    });
  });

  it('reports target supported when the cached Commander internal device export contains the target', async () => {
    const cacheRoot = path.join(tmpdir(), 'linkterm-jlink-device-catalog');
    const hash = createHash('sha256').update(commanderPath).digest('hex').slice(0, 16);
    const cachePath = path.join(cacheRoot, `ExpDevListXML-${hash}.xml`);
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(cachePath, `
      <DeviceDatabase>
        <VendorInfo Name="ST">
          <DeviceInfo Name="STM32H743II" Core="JLINK_CORE_CORTEX_M7" />
        </VendorInfo>
      </DeviceDatabase>
    `, 'utf-8');
    const client = new DefaultJLinkCommanderClient({ commanderPath, tempRoot: root });

    try {
      expect(client.checkAvailability('STM32H743II')).toMatchObject({
        available: true,
        commanderPath,
        targetSupported: true,
      });
    } finally {
      await rm(cachePath, { force: true });
    }
  });

  it('detects attached physical probes through ShowEmuList without opening a target connection', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: [
        'SEGGER J-Link Commander V7.96',
        'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        'J-Link[1]: Connection: USB, Serial number: 601012353, ProductName: J-Link EDU',
      ].join('\n'),
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(client.detectProbes()).resolves.toEqual([
      { probeId: 'physical-0', serialNumber: '601012352', connected: false },
      { probeId: 'physical-1', serialNumber: '601012353', connected: false },
    ]);

    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]!.args).toEqual([
      '-ExitOnError',
      '1',
      '-NoGui',
      '1',
      '-CommandFile',
      runner.scriptPath,
    ]);
    expect(runner.scriptContent).toBe('ShowEmuList\nq\n');
    expect(await exists(runner.scriptPath)).toBe(false);
  });

  it('reboots a J-Link probe without generating target connection lines', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'S/N: 123456789\nSerial number: 123456789\nReboot scheduled\n',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    const result = await client.rebootProbe({
      serialNumber: '123456789',
      force: true,
      reconnectTimeoutMs: 2000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[redacted]');
    expect(result.stdout).not.toContain('123456789');
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]!.args).toEqual([
      '-ExitOnError',
      '1',
      '-NoGui',
      '1',
      '-SelectEmuBySN',
      '123456789',
      '-CommandFile',
      runner.scriptPath,
    ]);
    expect(runner.scriptContent).toBe('Reboot force 2000\nq\n');
    expect(runner.scriptContent).not.toContain('device');
    expect(runner.scriptContent).not.toContain('connect');
    expect(await exists(runner.scriptPath)).toBe(false);
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
    expect(runner.requests).toHaveLength(2);
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
    expect(runner.scripts[0]).toContain('device AT32F435RGT7');
    expect(runner.scripts[0]).toContain('eoe 1');
    expect(runner.scripts[0]).toContain('si SWD');
    expect(runner.scripts[0]).toContain('speed 4000');
    expect(runner.scripts[0]).toContain('connect');
    expect(runner.scripts[0]).toContain('loadbin');
    expect(runner.scripts[0]).toContain('verifybin');
    expect(runner.scripts[0]).not.toContain('savebin');
    expect(runner.scripts[1]).toContain('verifybin');
    expect(runner.scripts[1]).toContain('savebin');
    expect(runner.scripts[1]).toContain('0x08008000');
    expect(runner.binaryContent).toEqual(binary);
    expect(await exists(runner.scriptPath)).toBe(false);
    expect(await exists(runner.binaryPath)).toBe(false);
  });

  it('uses SEGGER add-on device names consistently in CLI arguments and command script', async () => {
    await writeFile(path.join(root, 'JLinkDevices.xml'), '<Device><ChipInfo Name="-AT32F435VGT7"/></Device>');
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await client.download(
      { target: 'AT32F435VGT7', interface: 'swd', speedKHz: 4000 },
      Buffer.from([0x01, 0x02]),
      { address: 0x08008000, verify: true },
    );

    expect(runner.requests[0]!.args).toEqual(expect.arrayContaining(['-device', '-AT32F435VGT7']));
    expect(runner.scriptContent).toContain('device -AT32F435VGT7');
  });

  it('normalizes STM32 full order codes before passing target names to Commander', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await client.download(
      { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
      Buffer.from([0x01, 0x02]),
      { address: 0x08000000, verify: true },
    );

    expect(runner.requests[0]!.args).toEqual(expect.arrayContaining(['-device', 'STM32H743II']));
    expect(runner.scriptContent).toContain('device STM32H743II');
    expect(runner.scriptContent).not.toContain('STM32H743IIT6');
  });

  it('honors per-download timeout options when running Commander', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      Buffer.from([0x01]),
      { address: 0x08008000, verify: false, timeoutMs: 90_000 },
    );

    expect(runner.requests[0]!.timeoutMs).toBe(90_000);
  });

  it('uses the per-download timeout for the independent readback verify step', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      Buffer.from([0x01, 0x02]),
      { address: 0x08008000, verify: true, timeoutMs: 90_000 },
    );

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[0]!.timeoutMs).toBe(90_000);
    expect(runner.requests[1]!.timeoutMs).toBe(90_000);
  });

  it('scales the default download timeout for large raw binaries', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      Buffer.alloc(1024 * 1024),
      { address: 0x08008000, verify: false },
    );

    expect(runner.requests[0]!.timeoutMs).toBeGreaterThan(30_000);
  });

  it('keeps large raw binary downloads in one Commander operation so SEGGER owns flash sector erases', async () => {
    const runner = new CapturingProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });
    const binary = Buffer.alloc(128 * 1024 + 1, 0x5a);

    const result = await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      binary,
      { address: 0x08008000, verify: true },
    );

    expect(result).toEqual({ bytesWritten: binary.byteLength, verified: true });
    expect(runner.requests).toHaveLength(2);
    expect(runner.binaries).toHaveLength(2);
    expect(runner.binaries[0]).toEqual(binary);
    expect(runner.binaries[1]).toEqual(binary);
    expect(runner.scripts[0]).toContain('loadbin');
    expect(runner.scripts[0]).toContain('verifybin');
    expect(runner.scripts[0]).toContain('0x08008000');
    expect(runner.scripts[1]).toContain('savebin');
  });

  it('emits flash progress updates from streamed Commander output while downloading', async () => {
    const runner = new StreamingOutputProcessRunner([
      ['Erasing flash sectors...\n', 'Downloading file [firmware.bin]... 40%\n', 'Verify successful\n'],
      ['Reading back target flash...\n', 'Verify successful\n'],
    ]);
    runner.result = { exitCode: 0, signal: null, stdout: 'Verify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });
    const binary = Buffer.alloc(1024, 0xa5);
    const progress: FlashProgressUpdate[] = [];

    await client.download(
      { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      binary,
      { address: 0x08008000, verify: true, onProgress: (update) => progress.push(update) },
    );

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'erasing', bytesTotal: binary.byteLength }),
        expect.objectContaining({
          phase: 'programming',
          percent: 40,
          bytesWritten: 410,
          bytesTotal: binary.byteLength,
        }),
        expect.objectContaining({ phase: 'verifying', bytesTotal: binary.byteLength }),
        expect.objectContaining({ phase: 'readback', bytesTotal: binary.byteLength }),
        expect.objectContaining({
          phase: 'completed',
          percent: 100,
          bytesWritten: binary.byteLength,
          bytesTotal: binary.byteLength,
        }),
      ]),
    );
  });

  it('does not split unaligned raw binary downloads across artificial 64 KiB boundaries', async () => {
    const runner = new CapturingProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Downloading\nVerify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });
    const binary = Buffer.alloc(64 * 1024, 0xa5);

    await client.download(
      { target: 'AT32F435VGT7', interface: 'swd', speedKHz: 4000 },
      binary,
      { address: 0x08078000, verify: true },
    );

    expect(runner.requests).toHaveLength(2);
    expect(runner.binaries).toHaveLength(2);
    expect(runner.binaries[0]).toEqual(binary);
    expect(runner.binaries[1]).toEqual(binary);
    expect(runner.scripts[0]).toContain('0x08078000');
    expect(runner.scripts[1]).toContain('savebin');
  });

  it('uses unique temporary command files for concurrent Commander operations and cleans them up', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Verify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await Promise.all([
      client.download(
        { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        Buffer.from([0x01]),
        { address: 0x08008000, verify: true },
      ),
      client.download(
        { target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        Buffer.from([0x02]),
        { address: 0x08009000, verify: true },
      ),
    ]);

    expect(runner.observedScriptPaths).toHaveLength(4);
    expect(new Set(runner.observedScriptPaths).size).toBe(4);
    expect(new Set(runner.observedScriptPaths.map((p) => path.dirname(p))).size).toBe(4);
    expect(runner.observedBinaryPaths).toHaveLength(4);
    for (const scriptPath of runner.observedScriptPaths) {
      expect(await exists(scriptPath)).toBe(false);
      expect(await exists(path.dirname(scriptPath))).toBe(false);
    }
    for (const binaryPath of runner.observedBinaryPaths) {
      expect(await exists(binaryPath)).toBe(false);
    }
  });

  it('runs a JLinkMCP-style diagnostic script through LinkTerm-controlled connection lines', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'S/N: 123456789\n08080000 = 12 34 56 78\n',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    const result = await client.runScript(
      { target: 'AT32F435VGT7', interface: 'swd', speedKHz: 4000, serialNumber: '123456789' },
      ['device nRF52', 'si SWD', 'speed 4000', 'eoe', 'connect', 'r', 'mem 0x08080000, 64', 'q'],
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('08080000 = 12 34 56 78');
    expect(result.stdout).not.toContain('123456789');
    expect(runner.requests).toHaveLength(1);
    expect(runner.scriptContent).toContain('device AT32F435VGT7');
    expect(runner.scriptContent).not.toContain('device nRF52');
    expect(runner.scriptContent).toContain('\nr\n');
    expect(runner.scriptContent).toContain('\nmem 0x08080000, 64\n');
    expect((runner.scriptContent.match(/^connect$/gm) ?? [])).toHaveLength(1);
    expect((runner.scriptContent.match(/^q$/gm) ?? [])).toHaveLength(1);
    expect(await exists(runner.scriptPath)).toBe(false);
  });

  it('rejects file-backed commands in diagnostic scripts before spawning Commander', async () => {
    const runner = new FakeProcessRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.runScript({ target: 'AT32F435VGT7' }, ['loadbin "C:\\secret.bin", 0x08080000']),
    ).rejects.toBeInstanceOf(JLinkOperationError);
    expect(runner.requests).toHaveLength(0);
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

  it('adds target-access remediation guidance when a Commander target command times out', async () => {
    const runner = new TimeoutOnCommanderRunRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.readMemory({ target: 'STM32H743IIT6', interface: 'swd' }, { address: 0x08000000, length: 64 }),
    ).rejects.toThrow(/target power.*BOOT.*NRST.*SWD.*device.*protection/i);
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

  it('returns a mismatch when Commander verify output succeeds but binary readback differs', async () => {
    const runner = new VerifyReadbackMismatchRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    const result = await client.verify(
      { target: 'AT32F435RGT7' },
      Buffer.from([0xaa, 0xbb]),
      { address: 0x08008000 },
    );

    expect(result).toEqual({ ok: false, mismatchAt: 0x08008001 });
    expect(runner.scriptContent).toContain('verifybin');
    expect(runner.scriptContent).toContain('savebin');
  });

  it('formats savebin length as hex so Commander does not over-read decimal-looking sizes', async () => {
    const runner = new FakeProcessRunner();
    runner.result = { exitCode: 0, signal: null, stdout: 'Verify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    const result = await client.verify(
      { target: 'STM32H743II' },
      Buffer.alloc(1_081_656, 0xa5),
      { address: 0x08000000 },
    );

    expect(result).toEqual({ ok: true });
    expect(runner.scriptContent).toContain('savebin');
    expect(runner.scriptContent).toContain(', 0x00108138');
    expect(runner.scriptContent).not.toContain(', 1081656');
  });

  it('maps missing binary readback output to a stable J-Link operation error', async () => {
    const runner = new FakeProcessRunner();
    runner.writeReadback = false;
    runner.result = { exitCode: 0, signal: null, stdout: 'Verify successful\n', stderr: '' };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.verify(
        { target: 'AT32F435RGT7' },
        Buffer.from([0xaa, 0xbb]),
        { address: 0x08008000 },
      ),
    ).rejects.toBeInstanceOf(JLinkOperationError);
    await expect(
      client.verify(
        { target: 'AT32F435RGT7' },
        Buffer.from([0xaa, 0xbb]),
        { address: 0x08008000 },
      ),
    ).rejects.toThrow(/binary readback/i);
  });

  it('rejects verified downloads when independent binary readback differs', async () => {
    const runner = new VerifyReadbackMismatchRunner();
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.download(
        { target: 'AT32F435RGT7' },
        Buffer.from([0xaa, 0xbb]),
        { address: 0x08008000, verify: true },
      ),
    ).rejects.toThrow(/binary readback/i);
  });

  it('does not treat ambiguous verify output as a successful flash verification', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'J-Link Commander finished without a verify summary\n',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.verify(
        { target: 'AT32F435RGT7' },
        Buffer.from([0xaa, 0xbb]),
        { address: 0x08008000 },
      ),
    ).rejects.toThrow(/positive verify evidence/i);
  });

  it('rejects verified downloads when Commander output lacks positive verify evidence', async () => {
    const runner = new FakeProcessRunner();
    runner.result = {
      exitCode: 0,
      signal: null,
      stdout: 'Downloading file [firmware.bin]...\nO.K.\n',
      stderr: '',
    };
    const client = new DefaultJLinkCommanderClient({ commanderPath, runner, tempRoot: root });

    await expect(
      client.download(
        { target: 'AT32F435RGT7' },
        Buffer.from([0xaa, 0xbb]),
        { address: 0x08008000, verify: true },
      ),
    ).rejects.toThrow(/positive verify evidence/i);
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

describe('NetJLinkRttClient', () => {
  it('sends a SEGGER RTT Telnet config string when a control block address is supplied', async () => {
    const chunks: Buffer[] = [];
    let acceptedSocket: Socket | undefined;
    const server = createServer((socket) => {
      acceptedSocket = socket;
      socket.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });
    });
    await listen(server);
    try {
      const address = server.address() as AddressInfo;
      const client = new NetJLinkRttClient();
      const opts = {
        host: '127.0.0.1',
        port: address.port,
        controlBlockAddress: 0x24005310,
      };

      const session = await client.connect(opts);
      await waitForSocketData();

      expect(session.channels).toEqual([
        { index: 0, name: 'Terminal', direction: 'up', bufferSize: 0 },
        { index: 0, name: 'Terminal', direction: 'down', bufferSize: 0 },
      ]);
      expect(Buffer.concat(chunks).toString('utf8')).toBe(
        '$$SEGGER_TELNET_ConfigStr=SetRTTAddr;0x24005310$$',
      );
      await session.close();
    } finally {
      acceptedSocket?.destroy();
      await closeServer(server);
    }
  });

  it('rejects writes to channels without a reported RTT down-channel', async () => {
    const chunks: Buffer[] = [];
    let acceptedSocket: Socket | undefined;
    const server = createServer((socket) => {
      acceptedSocket = socket;
      socket.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });
    });
    await listen(server);
    try {
      const address = server.address() as AddressInfo;
      const client = new NetJLinkRttClient();
      const session = await client.connect({ host: '127.0.0.1', port: address.port });

      await expect(session.write(1, Buffer.from('help\r\n'))).rejects.toBeInstanceOf(
        JLinkInvalidStateError,
      );

      expect(chunks).toEqual([]);
      await session.close();
    } finally {
      acceptedSocket?.destroy();
      await closeServer(server);
    }
  });

  it('writes RTT terminal input to the SEGGER RTT telnet socket', async () => {
    const chunks: Buffer[] = [];
    let acceptedSocket: Socket | undefined;
    const server = createServer((socket) => {
      acceptedSocket = socket;
      socket.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });
    });
    await listen(server);
    try {
      const address = server.address() as AddressInfo;
      const client = new NetJLinkRttClient();
      const session = await client.connect({ host: '127.0.0.1', port: address.port });

      await session.write(0, Buffer.from('help\r'));
      await waitForSocketData();

      expect(Buffer.concat(chunks).toString('utf8')).toBe('help\r');
      await session.close();
    } finally {
      acceptedSocket?.destroy();
      await closeServer(server);
    }
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function waitForSocketData(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

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

  it('keeps GDB server available when local SEGGER XML databases do not list a target', () => {
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath });

    const availability = client.checkAvailability('AT32F435VGT7');

    expect(availability).toMatchObject({
      available: true,
      gdbServerPath,
      target: 'AT32F435VGT7',
      targetSupported: false,
    });
    expect(availability.message).toContain('not listed');
  });

  it('uses the sibling Commander internal device export cache for target support checks', async () => {
    const commanderPath = path.join(root, process.platform === 'win32' ? 'JLink.exe' : 'JLinkExe');
    const cacheRoot = path.join(tmpdir(), 'linkterm-jlink-device-catalog');
    const hash = createHash('sha256').update(commanderPath).digest('hex').slice(0, 16);
    const cachePath = path.join(cacheRoot, `ExpDevListXML-${hash}.xml`);
    await writeFile(commanderPath, '', 'utf-8');
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(cachePath, `
      <DeviceDatabase>
        <VendorInfo Name="ST">
          <DeviceInfo Name="STM32H743II" Core="Cortex-M7" />
        </VendorInfo>
      </DeviceDatabase>
    `, 'utf-8');
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath });

    try {
      expect(client.checkAvailability('STM32H743II')).toMatchObject({
        available: true,
        gdbServerPath,
        targetSupported: true,
      });
    } finally {
      await rm(cachePath, { force: true });
    }
  });

  it('rejects an untrusted relative GDB server path without spawning', async () => {
    const runner = new FakeManagedProcessRunner();
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath: 'JLinkGDBServerCL.exe', runner });

    await expect(client.start({ target: 'AT32F435RGT7' }, { port: 2331 })).rejects.toBeInstanceOf(JLinkOperationError);
    expect(runner.requests).toHaveLength(0);
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

  it('normalizes STM32 full order codes before starting GDB server', async () => {
    const runner = new FakeManagedProcessRunner();
    const client = new DefaultJLinkGdbServerClient({ gdbServerPath, runner, defaultTimeoutMs: 1234 });

    await client.start(
      { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
      { host: '127.0.0.1', port: 2331 },
    );

    expect(runner.requests[0]!.args).toEqual(expect.arrayContaining(['-device', 'STM32H743II']));
    expect(runner.requests[0]!.args).not.toContain('STM32H743IIT6');
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
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/S\/N: \[redacted\].*partial-output/);
  });
});
