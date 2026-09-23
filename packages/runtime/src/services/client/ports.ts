import type { ClientResult } from '@linkterm/contracts/client-api';

/** Identity is assigned by the authenticated host, never taken from request JSON. */
export interface ClientPeer {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}

export interface ClientInvocation {
  readonly sender: ClientPeer;
}

export interface ClientRequestRegistry {
  handle<T>(method: string, handler: (event: ClientInvocation, payload: T) => unknown): void;
  removeHandler(method: string): void;
}

/** Runtime services know peers and requests, without loading a window or network library. */
export interface ClientServiceHost {
  readonly requests: ClientRequestRegistry;
  getPeers(): readonly ClientPeer[];
  chooseWorkspaceRoot(): Promise<ClientResult<{ root: string | null }>>;
  chooseFirmwareFile(): Promise<ClientResult<{ path: string | null; baseAddress?: string }>>;
}
