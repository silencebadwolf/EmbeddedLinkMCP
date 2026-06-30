import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const doctorScriptPath = path.join(repoRoot, 'scripts', 'doctor-jlink.mjs');

async function importDoctorScript(): Promise<typeof import('../../../scripts/doctor-jlink.mjs')> {
  return import(pathToFileURL(doctorScriptPath).href);
}

function supportedTargetXml(target = 'STM32H743IIT6'): string {
  return `<Device><ChipInfo Name="${target}"/></Device>`;
}

describe('doctor-jlink script', () => {
  it('runs its CLI entrypoint when executed directly', () => {
    let output = '';
    let exitCode = 0;
    try {
      output = execFileSync(process.execPath, [doctorScriptPath], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          LINKTERM_JLINK_COMMANDER: path.join(repoRoot, 'missing-jlink.exe'),
        },
        windowsHide: true,
      });
    } catch (err) {
      exitCode = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 1;
      output = typeof err === 'object' && err !== null && 'stdout' in err && typeof err.stdout === 'string' ? err.stdout : '';
    }

    expect(exitCode).toBe(1);
    expect(output).toContain('J-Link Commander executable was not found');
  });

  it('is exposed through package.json', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['doctor:jlink']).toBe('node scripts/doctor-jlink.mjs');
  });

  it('parses ShowEmuList output without exposing serial numbers in summary messages', async () => {
    const { parseShowEmuList, checkJLinkEnvironment } = await importDoctorScript();
    const output = 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS';

    expect(parseShowEmuList(output)).toEqual([
      { index: 0, connection: 'USB', productName: 'J-Link PLUS' },
    ]);

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({ exitCode: 0, stdout: output, stderr: '' }),
    });

    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('1 J-Link probe(s) visible');
    expect(result.messages.join('\n')).not.toContain('601012352');
  });

  it('warns when stale JLink processes may be left by timed-out target connections', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      processNames: ['JLink', 'JLinkGUIServer'],
      runCommander: () => ({ exitCode: 0, stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS', stderr: '' }),
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(message).toContain('stale J-Link process');
    expect(message).toContain('Stop-Process');
  });

  it('warns when the LinkTerm MCP runtime is older than compiled J-Link artifacts', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
      runtimeMetadata: {
        pid: 21248,
        startedAt: '2026-06-29T12:49:36.000Z',
      },
      artifactStats: [
        {
          path: 'dist/main/jlink/segger-command-runner.js',
          mtimeMs: Date.parse('2026-06-29T16:00:20.000Z'),
        },
      ],
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(message).toContain('LinkTerm MCP runtime is older than compiled J-Link artifacts');
    expect(message).toContain('segger-command-runner.js');
    expect(message).toContain('Restart LinkTerm');
  });

  it('reports Commander startup failures with target-connection next steps', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({ exitCode: 1, stdout: '', stderr: 'USB backend failed' }),
    });

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toContain('J-Link Commander ShowEmuList failed');
    expect(result.messages.join('\n')).toContain('SEGGER installation');
  });

  it('suggests --project-root for workspace profile based target access checks', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
    });

    expect(result.messages.join('\n')).toContain('pass --target or --project-root');
  });

  it('distinguishes visible probe USB success from target-access timeout failures', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
      targetAccess: {
        target: 'STM32H743IIT6',
        interface: 'swd',
        speedKHz: 'auto',
        address: 0x08000000,
        length: 64,
        timeoutMs: 15_000,
      },
      runTargetAccess: () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'J-Link Commander timed out after 15000ms',
        timedOut: true,
      }),
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(message).toContain('1 J-Link probe(s) visible');
    expect(message).toContain('Target access check timed out after 15000ms');
    expect(message).toContain('Probe USB detection succeeded, but target MCU access did not complete');
    expect(message).toContain('target power/VTref');
    expect(message).toContain('exact SEGGER device name');
  });

  it('suggests fixed J-Link speeds when auto-speed target access times out', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
      targetAccess: {
        target: 'STM32H743IIT6',
        interface: 'swd',
        speedKHz: 'auto',
        address: 0x08000000,
        length: 64,
        timeoutMs: 15_000,
      },
      runTargetAccess: () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'J-Link Commander timed out after 15000ms',
        timedOut: true,
      }),
    });

    const message = result.messages.join('\n');
    expect(message).toContain('Retry with a fixed J-Link speed');
    expect(message).toContain('--speed 4000 --timeout-ms 15000');
    expect(message).toContain('--speed 1000 --timeout-ms 15000');
  });

  it('blocks target access when the local SEGGER database does not list the target', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();
    let targetAccessCalls = 0;

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: (filePath: string) => filePath.endsWith('JLink.exe') || filePath.endsWith('JLinkDevices.xml'),
      readFileSync: () => '<Device><ChipInfo Name="STM32H743XI"/></Device>',
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
      targetAccess: {
        target: 'STM32H743IIT6',
        interface: 'swd',
        speedKHz: 'auto',
        address: 0x08000000,
        length: 64,
        timeoutMs: 15_000,
      },
      runTargetAccess: () => {
        targetAccessCalls += 1;
        return {
          exitCode: 0,
          stdout: 'target access should not run for an unknown local SEGGER target',
          stderr: '',
          timedOut: false,
        };
      },
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(targetAccessCalls).toBe(0);
    expect(message).toContain('target STM32H743IIT6 is not listed');
    expect(message).toContain('Try STM32H743II');
    expect(message).toContain('would open the J-Link Device Selection dialog');
    expect(message).toContain('Update SEGGER J-Link');
    expect(message).toContain('control-profile.json');
  });

  it('classifies J-Link USB resynchronization failures separately from target MCU access failures', async () => {
    const { checkJLinkEnvironment } = await importDoctorScript();

    const result = checkJLinkEnvironment({
      platform: 'win32',
      commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
      existsSync: () => true,
      readFileSync: () => supportedTargetXml(),
      processNames: [],
      runCommander: () => ({
        exitCode: 0,
        stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
        stderr: '',
      }),
      targetAccess: {
        target: 'STM32H743IIT6',
        interface: 'swd',
        speedKHz: '1000',
        address: 0x08000000,
        length: 64,
        timeoutMs: 15_000,
      },
      runTargetAccess: () => ({
        exitCode: 1,
        stdout: 'Out of sync , resynchronizing...\nFAILED: Cannot connect to J-Link',
        stderr: '',
        timedOut: false,
      }),
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(message).toContain('J-Link probe USB transport failed after enumeration');
    expect(message).toContain('power-cycle or replug the J-Link probe');
    expect(message).toContain('SEGGER firmware/driver');
    expect(message).toContain('Target access output preview');
  });

  it('loads target-access defaults from a LinkTerm control profile workspace', async () => {
    const { targetAccessFromCli } = await importDoctorScript();
    const root = path.join(tmpdir(), `linkterm-doctor-profile-${Date.now()}`);
    await mkdir(path.join(root, '.linkterm'), { recursive: true });
    await writeFile(
      path.join(root, '.linkterm', 'control-profile.json'),
      JSON.stringify({
        jlink: { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 'auto' },
        flash: { baseAddress: '0x08000000' },
      }),
      'utf-8',
    );

    try {
      expect(targetAccessFromCli(['--root', root], process.cwd())).toEqual({
        target: 'STM32H743II',
        targetNormalization: {
          originalTarget: 'STM32H743IIT6',
          normalizedTarget: 'STM32H743II',
        },
        interface: 'swd',
        speedKHz: 'auto',
        address: 0x08000000,
        length: 64,
        timeoutMs: 15_000,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports stale profile target normalization before read-only target access', async () => {
    const { checkJLinkEnvironment, targetAccessFromCli } = await importDoctorScript();
    const root = path.join(tmpdir(), `linkterm-doctor-profile-${Date.now()}`);
    await mkdir(path.join(root, '.linkterm'), { recursive: true });
    await writeFile(
      path.join(root, '.linkterm', 'control-profile.json'),
      JSON.stringify({
        jlink: { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 'auto' },
        flash: { baseAddress: '0x08000000' },
      }),
      'utf-8',
    );

    try {
      const targetAccess = targetAccessFromCli(['--project-root', root], process.cwd());
      const result = checkJLinkEnvironment({
        platform: 'win32',
        commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
        existsSync: () => true,
        readFileSync: () => supportedTargetXml('STM32H743II'),
        processNames: [],
        runCommander: () => ({
          exitCode: 0,
          stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
          stderr: '',
        }),
        targetAccess,
        runTargetAccess: () => ({
          exitCode: 0,
          stdout: '08000000 = 20 0D 00 24  41 81 0A 08',
          stderr: '',
          timedOut: false,
        }),
      });

      const message = result.messages.join('\n');
      expect(message).toContain('Normalized J-Link target STM32H743IIT6 -> STM32H743II');
      expect(message).toContain('Target access check completed for STM32H743II');
      expect(message).not.toContain('target STM32H743IIT6 is not listed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports profile firmware vector sanity before target access', async () => {
    const { checkJLinkEnvironment, targetAccessFromCli } = await importDoctorScript();
    const root = path.join(tmpdir(), `linkterm-doctor-profile-${Date.now()}`);
    await mkdir(path.join(root, '.linkterm'), { recursive: true });
    const firmware = Buffer.alloc(0x100000, 0xff);
    firmware.writeUInt32LE(0x24000d20, 0);
    firmware.writeUInt32LE(0x080a8141, 4);
    await writeFile(path.join(root, 'rtthread.bin'), firmware);
    await writeFile(
      path.join(root, '.linkterm', 'control-profile.json'),
      JSON.stringify({
        jlink: { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 'auto' },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08000000' },
      }),
      'utf-8',
    );

    try {
      const targetAccess = targetAccessFromCli(['--project-root', root], process.cwd());
      const result = checkJLinkEnvironment({
        platform: 'win32',
        commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
        existsSync: () => true,
        readFileSync: () => supportedTargetXml(),
        processNames: [],
        runCommander: () => ({
          exitCode: 0,
          stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
          stderr: '',
        }),
        targetAccess,
        runTargetAccess: () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'J-Link Commander timed out after 15000ms',
          timedOut: true,
        }),
      });

      const message = result.messages.join('\n');
      expect(message).toContain('Firmware profile sanity: pass');
      expect(message).toContain('size=1048576');
      expect(message).toContain('SP=0x24000d20');
      expect(message).toContain('Reset=0x080a8141');
      expect(message).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a target flash header mismatch against the profile firmware', async () => {
    const { checkJLinkEnvironment, targetAccessFromCli } = await importDoctorScript();
    const root = path.join(tmpdir(), `linkterm-doctor-profile-${Date.now()}`);
    await mkdir(path.join(root, '.linkterm'), { recursive: true });
    const firmware = Buffer.alloc(64, 0xff);
    firmware.writeUInt32LE(0x24000d20, 0);
    firmware.writeUInt32LE(0x08000009, 4);
    await writeFile(path.join(root, 'rtthread.bin'), firmware);
    await writeFile(
      path.join(root, '.linkterm', 'control-profile.json'),
      JSON.stringify({
        jlink: { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08000000' },
      }),
      'utf-8',
    );

    try {
      const targetAccess = targetAccessFromCli(['--project-root', root], process.cwd());
      const result = checkJLinkEnvironment({
        platform: 'win32',
        commanderPath: 'D:\\Program Files\\SEGGER\\JLink\\JLink.exe',
        existsSync: () => true,
        readFileSync: () => supportedTargetXml(),
        processNames: [],
        runCommander: () => ({
          exitCode: 0,
          stdout: 'J-Link[0]: Connection: USB, Serial number: 601012352, ProductName: J-Link PLUS',
          stderr: '',
        }),
        targetAccess,
        runTargetAccess: () => ({
          exitCode: 0,
          stdout:
            '08000000 = FF FF FF FF  FF FF FF FF  FF FF FF FF  FF FF FF FF  ................\n' +
            '08000010 = FF FF FF FF  FF FF FF FF  FF FF FF FF  FF FF FF FF  ................\n' +
            '08000020 = FF FF FF FF  FF FF FF FF  FF FF FF FF  FF FF FF FF  ................\n' +
            '08000030 = FF FF FF FF  FF FF FF FF  FF FF FF FF  FF FF FF FF  ................\n',
          stderr: '',
          timedOut: false,
        }),
      });

      const message = result.messages.join('\n');
      expect(result.ok).toBe(false);
      expect(message).toContain('Target flash header mismatch');
      expect(message).toContain('0x08000000');
      expect(message).toContain('expected 0x20, read 0xff');
      expect(message).toContain('reads as erased');
      expect(message).toContain('verified flash workflow');
      expect(message).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts --project-root so package managers do not confuse workspace/root options', async () => {
    const { targetAccessFromCli } = await importDoctorScript();
    const root = path.join(tmpdir(), `linkterm-doctor-profile-${Date.now()}`);
    await mkdir(path.join(root, '.linkterm'), { recursive: true });
    await writeFile(
      path.join(root, '.linkterm', 'control-profile.json'),
      JSON.stringify({
        jlink: { target: 'STM32H743IIT6', interface: 'swd', speedKHz: 'auto' },
        flash: { baseAddress: '0x08000000' },
      }),
      'utf-8',
    );

    try {
      expect(targetAccessFromCli(['--project-root', root], process.cwd())).toMatchObject({
        target: 'STM32H743II',
        address: 0x08000000,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes package-manager escaped UNC-style project roots before reading the profile', async () => {
    const { normalizeProjectRootPath } = await importDoctorScript();

    expect(normalizeProjectRootPath('\\\\\\\\wsl.localhost\\\\Ubuntu-24.04\\\\home\\\\jianyin\\\\code\\\\FNA1000')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\code\\FNA1000',
    );
  });

  it('renders a read-only target-access script that also probes Cortex-M DHCSR', async () => {
    const { renderTargetAccessScript } = await importDoctorScript();

    const script = renderTargetAccessScript({
      target: 'STM32H743IIT6',
      interface: 'swd',
      speedKHz: 'auto',
      address: 0x08000000,
      length: 64,
      timeoutMs: 15_000,
    });

    expect(script).toContain('mem 0x08000000, 64');
    expect(script).toContain('mem 0xe000edf0, 4');
    expect(script).toContain('device STM32H743II');
    expect(script).not.toContain('STM32H743IIT6');
    expect(script).not.toMatch(/\b(?:r|h|erase|loadbin|verifybin|w1|w2|w4|wreg)\b/iu);
  });

});
