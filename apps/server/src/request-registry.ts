import type { ClientInvocation, ClientRequestRegistry } from '@linkterm/runtime/services/client/ports';
import { HttpError } from './http-utils.js';

/** Only registered business commands can be invoked; event names are never commands. */
export class RequestRegistry implements ClientRequestRegistry {
  readonly #handlers = new Map<string, (event: ClientInvocation, payload: unknown) => unknown>();
  handle<T>(method: string, handler: (event: ClientInvocation, payload: T) => unknown): void {
    if (this.#handlers.has(method)) throw new Error(`Duplicate client handler: ${method}`);
    this.#handlers.set(method, (event, payload) => handler(event, payload as T));
  }
  removeHandler(method: string): void { this.#handlers.delete(method); }
  has(method: string): boolean { return this.#handlers.has(method); }
  async invoke(method: string, event: ClientInvocation, payload: unknown): Promise<unknown> {
    const handler = this.#handlers.get(method);
    if (!handler) throw new HttpError(404, 'METHOD_NOT_FOUND');
    return handler(event, payload);
  }
}
