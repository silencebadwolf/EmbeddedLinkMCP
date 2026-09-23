import { createHash } from 'node:crypto';
import { WEB_REQUEST_WINDOW_MS, type WebRequest } from '@linkterm/contracts/web-protocol';
import { HttpError, failure } from './http-utils.js';

interface Entry {
  readonly fingerprint: string;
  readonly expiresAt: number;
  result?: Promise<unknown>;
  settled: boolean;
  value?: unknown;
  bytes: number;
}

/** Bounded command deduplication; valid entries are refused, never silently evicted. */
export class RequestLedger {
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;
  #pending = 0;
  #closing = false;
  execute(sessionId: string, request: WebRequest, invoke: () => Promise<unknown>): Promise<unknown> {
    const now = Date.now();
    this.#prune(now);
    if (this.#closing) throw new HttpError(503, 'SERVER_STOPPING');
    if (request.issuedAt < now - WEB_REQUEST_WINDOW_MS || request.issuedAt > now + 30_000) throw new HttpError(409, 'REQUEST_TIME_INVALID');
    const key = `${sessionId}:${request.id}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([request.issuedAt, request.method, request.payload])).digest('hex');
    const existing = this.#entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'REQUEST_ID_CONFLICT');
      return existing.settled ? Promise.resolve(existing.value) : existing.result!;
    }
    if (this.#entries.size >= 2_000 || this.#pending >= 64 || this.#bytes >= 32 * 1024 * 1024) throw new HttpError(429, 'REQUEST_CAPACITY');
    this.#pending++;
    const entry: Entry = {
      fingerprint, expiresAt: request.issuedAt + WEB_REQUEST_WINDOW_MS + 1, settled: false, bytes: 0,
    };
    const result = Promise.resolve().then(invoke).catch(error => error instanceof HttpError ? failure(error.code, error.message) : failure('INTERNAL', 'The operation failed')).then(rawValue => {
        let value = rawValue ?? null;
        let bytes: number;
        try { bytes = Buffer.byteLength(JSON.stringify(value)); }
        catch { value = failure('INVALID_RESPONSE'); bytes = Buffer.byteLength(JSON.stringify(value)); }
        this.#pending--;
        entry.value = bytes <= 1024 * 1024 && this.#bytes + bytes <= 32 * 1024 * 1024
          ? value : failure('RESULT_NOT_RETAINED', 'The result was too large to retain; do not repeat an uncertain command');
        entry.bytes = Buffer.byteLength(JSON.stringify(entry.value));
        this.#bytes += entry.bytes;
        entry.settled = true;
        entry.result = undefined;
        return value;
      });
    entry.result = result;
    this.#entries.set(key, entry);
    return result;
  }
  status(sessionId: string, id: string): unknown {
    this.#prune(Date.now());
    const entry = this.#entries.get(`${sessionId}:${id}`);
    if (!entry) throw new HttpError(404, 'REQUEST_UNKNOWN');
    return entry.settled ? { state: 'completed', result: entry.value } : { state: 'pending' };
  }
  stopAccepting(): void { this.#closing = true; }
  async settle(): Promise<void> { await Promise.allSettled([...this.#entries.values()].map(entry => entry.result)); }
  #prune(now: number): void {
    for (const [key, entry] of this.#entries) if (entry.settled && entry.expiresAt <= now) {
      this.#entries.delete(key); this.#bytes -= entry.bytes;
    }
  }
}
