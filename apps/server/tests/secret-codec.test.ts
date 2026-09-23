import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ServerSecretCodec, readOrCreateSecret } from '../src/secret-codec.js';

it('encrypts credentials with authenticated host key metadata and rejects wrong keys or tampering', () => {
  const codec = new ServerSecretCodec(randomBytes(32));
  const value = codec.encryptUtf8('private-password');
  expect(codec.decryptUtf8(value)).toBe('private-password');
  expect(() => new ServerSecretCodec(randomBytes(32)).decryptUtf8(value)).toThrow();
  const changed = Buffer.from(value, 'base64'); changed[changed.length - 1] ^= 1;
  expect(() => codec.decryptUtf8(changed.toString('base64'))).toThrow();
  expect(value).not.toContain('private-password');
});

it('creates one private key file and reuses it without rotating silently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkterm-web-key-'));
  try {
    const file = join(dir, 'secret');
    const first = await readOrCreateSecret(file);
    expect(await readOrCreateSecret(file)).toBe(first);
    expect(Buffer.from(first, 'base64')).toHaveLength(32);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
