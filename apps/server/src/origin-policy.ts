import type { IncomingMessage } from 'node:http';
import { HttpError } from './http-utils.js';

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Explicit authority prevents DNS rebinding and cross-site cookie/WebSocket requests. */
export class OriginPolicy {
  readonly #origins: Set<string>;
  readonly #hosts: Set<string>;
  constructor(origins: readonly string[]) {
    const urls = origins.map(value => new URL(value));
    this.#origins = new Set(urls.map(url => url.origin));
    this.#hosts = new Set(urls.map(url => url.host));
  }
  checkHost(request: IncomingMessage): void {
    if (!request.headers.host || !this.#hosts.has(request.headers.host)) throw new HttpError(403, 'HOST_REJECTED');
  }
  checkOrigin(request: IncomingMessage, required = true): void {
    const origin = request.headers.origin;
    if (origin === undefined && !required) return;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) throw new HttpError(403, 'ORIGIN_REJECTED');
  }
}
