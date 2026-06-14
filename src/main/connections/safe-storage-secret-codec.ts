import { safeStorage } from 'electron';
import type { SecretCodec } from '../../core/connections/index.js';

/** Electron safeStorage-backed credential codec for saved connection profiles. */
export class SafeStorageSecretCodec implements SecretCodec {
  /** @inheritdoc */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /** @inheritdoc */
  encryptUtf8(value: string): string {
    return safeStorage.encryptString(value).toString('base64');
  }

  /** @inheritdoc */
  decryptUtf8(value: string): string {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
}
