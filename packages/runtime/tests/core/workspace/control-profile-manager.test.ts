import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CONTROL_PROFILE_SCHEMA_VERSION,
  ControlProfileAlreadyInitializedError,
  ControlProfileManager,
  ControlProfileNotFoundError,
} from '@linkterm/runtime/core/workspace/index';

async function createTmpRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'lt-control-profile-'));
}

describe('ControlProfileManager (real fs)', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTmpRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('init creates .linkterm/control-profile.json and preserves hex addresses as strings', async () => {
    const manager = new ControlProfileManager();
    const profile = await manager.init(root, {
      serial: { enabled: true, port: 'COM3', baudRate: 115200, mode: 'terminal' },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      rtt: { enabled: false, channels: [0] },
    });

    expect(profile.schemaVersion).toBe(CONTROL_PROFILE_SCHEMA_VERSION);
    expect(profile.flash?.baseAddress).toBe('0x08000000');

    const raw = await readFile(path.join(root, '.linkterm', 'control-profile.json'), 'utf-8');
    const persisted = JSON.parse(raw) as { flash: { baseAddress: string } };
    expect(persisted.flash.baseAddress).toBe('0x08000000');
  });

  it('load throws ControlProfileNotFoundError when the profile does not exist', async () => {
    const manager = new ControlProfileManager();
    await expect(manager.load(root)).rejects.toBeInstanceOf(ControlProfileNotFoundError);
  });

  it('init throws ControlProfileAlreadyInitializedError on second call without force', async () => {
    const manager = new ControlProfileManager();
    await manager.init(root, { jlink: { enabled: false } });
    await expect(manager.init(root, { jlink: { enabled: false } })).rejects.toBeInstanceOf(
      ControlProfileAlreadyInitializedError,
    );
  });

  it('rejects decimal flash baseAddress strings', async () => {
    const manager = new ControlProfileManager();
    await expect(
      manager.init(root, {
        flash: { binary: 'build/app.bin', baseAddress: '134217728', verify: true },
      } as never),
    ).rejects.toThrow();
  });

  it('persists a hexadecimal RTT control block address unchanged', async () => {
    const manager = new ControlProfileManager();
    const profile = await manager.init(root, {
      rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24005310' },
    } as Parameters<ControlProfileManager['init']>[1]);

    expect(profile.rtt?.controlBlockAddress).toBe('0x24005310');
    const raw = await readFile(path.join(root, '.linkterm', 'control-profile.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({
      rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24005310' },
    });
  });

  it('rejects decimal RTT control block addresses', async () => {
    const manager = new ControlProfileManager();
    await expect(
      manager.init(root, {
        rtt: { enabled: true, controlBlockAddress: '604001040' },
      } as never),
    ).rejects.toThrow();
  });

  it('normalizes STM32 order-code jlink targets before persisting', async () => {
    const manager = new ControlProfileManager();
    const profile = await manager.init(root, {
      jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
    });

    expect(profile.jlink?.target).toBe('STM32H743II');
    const raw = await readFile(path.join(root, '.linkterm', 'control-profile.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({ jlink: { target: 'STM32H743II' } });
  });

  it('rejects profiles that enable serial and RTT log observation together', async () => {
    const manager = new ControlProfileManager();
    await expect(
      manager.init(root, {
        serial: { enabled: true, port: 'COM3', baudRate: 115200, mode: 'terminal' },
        rtt: { enabled: true, channels: [0] },
      }),
    ).rejects.toThrow(/serial.*RTT|RTT.*serial/i);
  });
});
