import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ConnectionProfileManager,
  CredentialStorageUnavailableError,
  CONNECTIONS_SCHEMA_VERSION,
  type SecretCodec,
} from '@/core/connections/index.js';
import type { SshCredentialsPayload } from '@/shared/preload-api.js';

class ReversibleCodec implements SecretCodec {
  constructor(private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  encryptUtf8(value: string): string {
    return Buffer.from(`sealed:${value}`, 'utf-8').toString('base64');
  }

  decryptUtf8(value: string): string {
    const raw = Buffer.from(value, 'base64').toString('utf-8');
    if (!raw.startsWith('sealed:')) throw new Error('bad seal');
    return raw.slice('sealed:'.length);
  }
}

async function createTmpFile(): Promise<{ root: string; filePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-connections-'));
  return { root, filePath: path.join(root, 'connections.json') };
}

describe('ConnectionProfileManager', () => {
  let root: string;
  let filePath: string;

  beforeEach(async () => {
    const tmp = await createTmpFile();
    root = tmp.root;
    filePath = tmp.filePath;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves serial profiles with common wire parameters and lists sanitized summaries', async () => {
    const manager = new ConnectionProfileManager({ filePath, secretCodec: new ReversibleCodec() });

    const saved = await manager.save({
      label: 'STM32 console',
      config: {
        type: 'serial',
        port: 'COM3',
        baudRate: 921600,
        mode: 'terminal',
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: true,
        xon: false,
        xoff: false,
      },
      saveCredentials: false,
    });

    expect(saved.label).toBe('STM32 console');
    expect(saved.type).toBe('serial');
    expect(saved.hasCredential).toBe(false);
    expect(saved.config).toMatchObject({
      type: 'serial',
      port: 'COM3',
      baudRate: 921600,
      mode: 'terminal',
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: true,
    });

    const list = await manager.list();
    expect(list).toEqual([saved]);

    const raw = JSON.parse(await readFile(filePath, 'utf-8')) as { schemaVersion: string };
    expect(raw.schemaVersion).toBe(CONNECTIONS_SCHEMA_VERSION);
  });

  it('encrypts ssh credentials at rest and restores them only for openConfig()', async () => {
    const manager = new ConnectionProfileManager({ filePath, secretCodec: new ReversibleCodec() });
    const credentials: SshCredentialsPayload = {
      kind: 'password',
      password: 'super-secret',
    };

    const saved = await manager.save({
      label: 'lab ssh',
      config: {
        type: 'ssh',
        host: '192.0.2.10',
        port: 22,
        username: 'root',
        credentials,
      },
      saveCredentials: true,
    });

    expect(saved.hasCredential).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('super-secret');

    const persisted = await readFile(filePath, 'utf-8');
    expect(persisted).not.toContain('super-secret');
    expect(persisted).not.toContain('password');

    const restored = await manager.openConfig(saved.id);
    expect(restored).toMatchObject({
      type: 'ssh',
      host: '192.0.2.10',
      port: 22,
      username: 'root',
      credentials,
    });
  });

  it('rejects saving ssh credentials when secure storage is unavailable', async () => {
    const manager = new ConnectionProfileManager({
      filePath,
      secretCodec: new ReversibleCodec(false),
    });

    await expect(
      manager.save({
        label: 'lab ssh',
        config: {
          type: 'ssh',
          host: '192.0.2.10',
          port: 22,
          username: 'root',
          credentials: { kind: 'password', password: 'secret' },
        },
        saveCredentials: true,
      }),
    ).rejects.toBeInstanceOf(CredentialStorageUnavailableError);
  });
});
