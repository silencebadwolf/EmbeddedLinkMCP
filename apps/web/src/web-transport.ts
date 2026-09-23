import { CLIENT_CHANNELS } from '@linkterm/contracts/client-protocol';
import type { ClientTransport } from '@linkterm/contracts/client-transport';
import { WEB_PROTOCOL_VERSION, type WebRequest, type WebRuntimeInfo, type WebServerFrame } from '@linkterm/contracts/web-protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'auth-required' | 'closed';
export interface DirectoryChoice { readonly id: string; readonly name: string; readonly path: string; }
export interface DirectoryListing { readonly current: DirectoryChoice | null; readonly directories: readonly DirectoryChoice[]; }
type Listener = (event: unknown, payload: unknown) => void;
const streamed = new Set<string>([CLIENT_CHANNELS.SESSION_WRITE, CLIENT_CHANNELS.SESSION_RESIZE, CLIENT_CHANNELS.TRANSCRIPT_SUBSCRIBE]);
const REQUEST_TIMEOUT_MS = 30_000;
const failure = (code: string, message = code) => ({ success: false as const, error: { code, message } });

/** Browser-side transport: reconnects listeners, never automatically repeats a command. */
export class WebTransport implements ClientTransport {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #statusListeners = new Set<(status: ConnectionStatus) => void>();
  readonly #pending = new Map<string, { resolve: (result: unknown) => void; timeout: number }>();
  readonly #uncertain = new Set<string>();
  readonly #unrecoverable = new Set<string>();
  #socket?: WebSocket;
  #clientId?: string;
  #csrf: string;
  #runtime: WebRuntimeInfo;
  #status: ConnectionStatus = 'connecting';
  #reconnectTimer?: number;
  #attempts = 0;
  #clockOffset = 0;
  #generation = 0;
  #runtimeReplaced = false;
  #workspacePicker?: () => Promise<string | null>;
  constructor(csrf: string, runtime: WebRuntimeInfo) {
    this.#csrf = csrf; this.#runtime = runtime; this.#clockOffset = runtime.serverTime - Date.now();
  }
  get runtime(): WebRuntimeInfo { return this.#runtime; }
  get status(): ConnectionStatus { return this.#status; }
  get generation(): number { return this.#generation; }
  get uncertainRequests(): readonly string[] { return [...this.#uncertain]; }
  get unrecoverableRequests(): readonly string[] { return [...this.#unrecoverable]; }
  get runtimeReplaced(): boolean { return this.#runtimeReplaced; }
  setWorkspacePicker(picker: () => Promise<string | null>): void { this.#workspacePicker = picker; }
  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener); listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }
  on<T>(channel: string, listener: (event: unknown, payload: T) => void): void {
    const listeners = this.#listeners.get(channel) ?? new Set<Listener>();
    listeners.add(listener as Listener); this.#listeners.set(channel, listeners);
  }
  removeListener<T>(channel: string, listener: (event: unknown, payload: T) => void): void {
    this.#listeners.get(channel)?.delete(listener as Listener);
  }
  connect(): void {
    if (this.#status === 'closed' || this.#socket && this.#socket.readyState < WebSocket.CLOSING) return;
    this.#setStatus('connecting');
    const url = new URL('/api/events', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.#socket = socket;
    const handshakeTimeout = window.setTimeout(() => socket.close(1008, 'Server hello timed out'), 10_000);
    socket.addEventListener('message', event => {
      let frame: WebServerFrame;
      try { frame = JSON.parse(event.data as string) as WebServerFrame; } catch { socket.close(1008, 'Invalid server frame'); return; }
      if (frame.type === 'hello') {
        if (frame.protocol !== WEB_PROTOCOL_VERSION || typeof frame.clientId !== 'string' || !frame.runtime || frame.runtime.protocol !== WEB_PROTOCOL_VERSION) { socket.close(1008, 'Protocol mismatch'); return; }
        clearTimeout(handshakeTimeout);
        const replaced = frame.runtime.id !== this.#runtime.id;
        if (replaced) {
          this.#runtimeReplaced = true;
          for (const id of this.#uncertain) this.#unrecoverable.add(id);
          this.#uncertain.clear();
        }
        this.#runtime = frame.runtime; this.#clockOffset = frame.runtime.serverTime - Date.now();
        this.#clientId = frame.clientId; this.#attempts = 0; this.#generation++;
        this.#setStatus('connected');
        if (!replaced) void this.#checkUncertainRequests();
        return;
      }
      if (frame.type === 'event' && typeof frame.channel === 'string') {
        for (const listener of this.#listeners.get(frame.channel) ?? []) listener(undefined, frame.payload);
      } else if (frame.type === 'response' && typeof frame.id === 'string') {
        const pending = this.#pending.get(frame.id);
        if (pending) { clearTimeout(pending.timeout); pending.resolve(frame.result); this.#pending.delete(frame.id); }
      }
    });
    socket.addEventListener('close', () => {
      clearTimeout(handshakeTimeout);
      if (this.#socket !== socket) return;
      this.#clientId = undefined;
      for (const [id, pending] of this.#pending) {
        clearTimeout(pending.timeout);
        this.#uncertain.add(id);
        pending.resolve(failure('CONNECTION_LOST', `Command ${id} may have run; check its status after reconnecting`));
      }
      this.#pending.clear();
      if (this.#status === 'closed') return;
      this.#setStatus('disconnected');
      void (async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3_000);
        try {
          const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
          if (this.#status === 'closed') return;
          if (response.status === 401) { this.#setStatus('auth-required'); return; }
        } catch { /* The server may be offline; continue reconnecting. */ }
        finally { clearTimeout(timeout); }
        if (this.#status !== 'closed')
          this.#reconnectTimer = window.setTimeout(() => this.connect(), Math.min(8_000, 500 * 2 ** Math.min(this.#attempts++, 4)));
      })();
    });
  }
  async invoke(method: string, payload?: unknown): Promise<unknown> {
    if (this.#status !== 'connected' || !this.#clientId || !this.#socket) return failure('CONNECTION_LOST', 'Reconnect before sending another command');
    if (method === CLIENT_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT) {
      if (!this.#workspacePicker) return failure('WORKSPACE_PICKER_UNAVAILABLE');
      try { return { success: true, data: { root: await this.#workspacePicker() } }; }
      catch { return failure('WORKSPACE_PICKER_FAILED'); }
    }
    if (method === CLIENT_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE) return this.#chooseFirmwareFile();
    const request: WebRequest = { id: crypto.randomUUID(), issuedAt: Date.now() + this.#clockOffset, method: method as WebRequest['method'], payload };
    if (streamed.has(method)) {
      const socket = this.#socket;
      return new Promise(resolve => {
        const timeout = window.setTimeout(() => {
          if (!this.#pending.has(request.id)) return;
          this.#pending.delete(request.id); this.#uncertain.add(request.id);
          resolve(failure('CONNECTION_LOST', `Command ${request.id} may have run; check its status after reconnecting`));
          socket.close();
        }, REQUEST_TIMEOUT_MS);
        this.#pending.set(request.id, { resolve, timeout });
        try { socket.send(JSON.stringify({ type: 'request', request })); }
        catch {
          clearTimeout(timeout); this.#pending.delete(request.id); this.#uncertain.add(request.id);
          socket.close(); resolve(failure('CONNECTION_LOST'));
        }
      });
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/request', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Linkterm-Csrf': this.#csrf, 'X-Linkterm-Client': this.#clientId },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401) this.#socket.close(1008, 'Authentication expired');
        return body;
      }
      return body;
    } catch {
      this.#uncertain.add(request.id);
      this.#setStatus('disconnected');
      this.#socket.close();
      return failure('CONNECTION_LOST', `Command ${request.id} may have run; check its status after reconnecting`);
    } finally {
      clearTimeout(timeout);
    }
  }
  async listWorkspaces(parentId?: string): Promise<DirectoryListing> {
    const address = new URL('/api/workspaces', location.href);
    if (parentId) address.searchParams.set('parentId', parentId);
    const response = await fetch(address, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to list server workspaces');
    return response.json() as Promise<DirectoryListing>;
  }
  async selectWorkspace(id: string): Promise<string> {
    const result = await this.#postJson('/api/workspaces/select', { id });
    return (result as { root: string }).root;
  }
  async createWorkspace(parentId: string, name: string): Promise<DirectoryChoice> {
    return this.#postJson('/api/workspaces/create', { parentId, name }) as Promise<DirectoryChoice>;
  }
  async #postJson(url: string, body: unknown): Promise<unknown> {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Linkterm-Csrf': this.#csrf }, body: JSON.stringify(body) });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error('The server rejected the workspace operation');
    return result;
  }
  async #chooseFirmwareFile(): Promise<unknown> {
    const file = await new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.bin,.hex,.elf';
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return { success: true, data: { path: null } };
    if (file.size > 32 * 1024 * 1024) return failure('FIRMWARE_SIZE_INVALID', 'Firmware exceeds the 32 MiB upload limit');
    try {
      const response = await fetch('/api/resources/upload', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Linkterm-Csrf': this.#csrf, 'X-Linkterm-Filename': encodeURIComponent(file.name) }, body: file });
      const result: unknown = await response.json();
      if (!response.ok) return result;
      const uploaded = result as { id: string; baseAddress?: string };
      return { success: true, data: { path: uploaded.id, ...(uploaded.baseAddress ? { baseAddress: uploaded.baseAddress } : {}) } };
    } catch { return failure('UPLOAD_FAILED', 'Firmware upload did not complete; try selecting the file again'); }
  }
  async activateUiTarget(): Promise<boolean> {
    if (!this.#clientId) return false;
    const response = await fetch('/api/ui-target', { method: 'POST', credentials: 'same-origin', headers: { 'X-Linkterm-Csrf': this.#csrf, 'X-Linkterm-Client': this.#clientId } });
    return response.ok;
  }
  async logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Linkterm-Csrf': this.#csrf } });
    this.close();
  }
  close(): void {
    this.#setStatus('closed');
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#socket?.close(); this.#listeners.clear();
  }
  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }
  async #checkUncertainRequests(): Promise<void> {
    for (const id of [...this.#uncertain]) {
      try {
        const response = await fetch(`/api/requests/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
        if (response.ok && (await response.json() as { state?: string }).state === 'completed') this.#uncertain.delete(id);
      } catch { break; }
    }
    this.#setStatus(this.#status);
  }
}
