import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CONTROL_PROFILE_RECORDS_SCHEMA_VERSION,
  ControlProfileRecordManager,
  type FsPrimitives,
} from '@/core/workspace/index.js';

async function createTmpRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'lt-control-profile-records-'));
}

function createMemoryFs(): FsPrimitives {
  const files = new Map<string, string>();
  return {
    readFile: async (p) => {
      const data = files.get(p);
      if (data === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return data;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
    },
    mkdir: async () => {},
    rename: async (from, to) => {
      const data = files.get(from);
      if (data === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      files.set(to, data);
      files.delete(from);
    },
    unlink: async (p) => {
      if (!files.delete(p)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    },
    stat: async (p) => {
      const data = files.get(p);
      if (data === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return { isFile: () => true, size: data.length };
    },
  };
}

describe('ControlProfileRecordManager (real fs)', () => {
  let root: string;
  let filePath: string;

  beforeEach(async () => {
    root = await createTmpRoot();
    filePath = path.join(root, 'control-profiles.json');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores a reusable control profile record with source metadata', async () => {
    const manager = new ControlProfileRecordManager({ filePath });

    const record = await manager.save({
      root: 'C:/repo',
      source: 'manual',
      profile: {
        schemaVersion: 'linkterm-control/1.0.0',
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd', speedKHz: 'auto' },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
    });

    expect(record).toMatchObject({
      label: 'repo - STM32H743II',
      root: 'C:/repo',
      source: 'manual',
      profile: {
        schemaVersion: 'linkterm-control/1.0.0',
        jlink: { target: 'STM32H743II' },
      },
    });
    expect(record.id).toMatch(/^ctrl_/u);
    expect(new Date(record.createdAt).toString()).not.toBe('Invalid Date');

    await expect(manager.list()).resolves.toEqual([record]);
    const persisted = JSON.parse(await readFile(filePath, 'utf-8')) as { schemaVersion: string };
    expect(persisted.schemaVersion).toBe(CONTROL_PROFILE_RECORDS_SCHEMA_VERSION);
  });

  it('updates the existing record when the same root and profile are saved again', async () => {
    const manager = new ControlProfileRecordManager({ filePath });
    const profile = {
      schemaVersion: 'linkterm-control/1.0.0' as const,
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd' as const, speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    };

    const first = await manager.save({ root: 'C:/repo', source: 'manual', profile });
    const second = await manager.save({ root: 'C:/repo', source: 'ai', profile });

    expect(second.id).toBe(first.id);
    expect(second.source).toBe('ai');
    expect(second.createdAt).toBe(first.createdAt);
    expect(await manager.list()).toHaveLength(1);
  });

  it('keeps the newest 200 records when history grows', async () => {
    const manager = new ControlProfileRecordManager({
      filePath,
      fs: createMemoryFs(),
    });

    for (let i = 0; i < 201; i += 1) {
      await manager.save({
        root: `C:/repo-${i}`,
        source: 'manual',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          jlink: { enabled: true, target: `DEVICE_${i}`, interface: 'swd', speedKHz: 4000 },
        },
      });
    }

    const records = await manager.list();
    expect(records).toHaveLength(200);
    expect(records.some((record) => record.root === 'C:/repo-0')).toBe(false);
    expect(records.some((record) => record.root === 'C:/repo-200')).toBe(true);
  });
});
