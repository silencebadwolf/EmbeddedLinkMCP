import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretCodec } from '@linkterm/runtime/core/connections/types';

/** Host key is never part of the Web bundle or a profile export. */
export class ServerSecretCodec implements SecretCodec {
  readonly provider = 'server-aes-256-gcm' as const;
  readonly keyId: string;
  readonly #key: Buffer;
  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new Error('The server credential key must be exactly 32 bytes');
    this.#key = Buffer.from(key);
    this.keyId = `sha256:${createHash('sha256').update(this.#key).digest('hex')}`;
  }
  isAvailable(): boolean { return true; }
  encryptUtf8(value: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(`${this.provider}/1/${this.keyId}`));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64');
  }
  decryptUtf8(value: string): string {
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) throw new Error('Invalid encrypted credential');
    const data = Buffer.from(value, 'base64');
    if (data.length < 28) throw new Error('Invalid encrypted credential');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${this.provider}/1/${this.keyId}`));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** Create private host material once; a concurrent creator cannot overwrite it. */
export async function readOrCreateSecret(file: string): Promise<string> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try { await writeFile(file, randomBytes(32).toString('base64') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value) || Buffer.from(value, 'base64').length !== 32) throw new Error(`Invalid host secret file: ${file}`);
  return value;
}
