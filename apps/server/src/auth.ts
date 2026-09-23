import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './http-utils.js';

const COOKIE_NAME = 'linkterm_session';
const SESSION_TTL = 8 * 60 * 60_000;
export interface AuthSession { readonly id: string; readonly csrf: string; readonly expiresAt: number; }

export class AuthService {
  readonly #tokenHash: Buffer;
  readonly #sessions = new Map<string, AuthSession>();
  readonly #attempts = new Map<string, { count: number; until: number }>();
  constructor(token: string, readonly secureCookie: boolean) {
    if (token.length < 32 || token.length > 256) throw new Error('The access token must contain 32–256 characters');
    this.#tokenHash = createHash('sha256').update(token).digest();
  }
  acceptsToken(token: string): boolean {
    return token.length <= 256 && timingSafeEqual(this.#tokenHash, createHash('sha256').update(token).digest());
  }
  login(token: unknown, remoteAddress: string): AuthSession {
    const now = Date.now();
    for (const [key, value] of this.#attempts) if (value.until <= now) this.#attempts.delete(key);
    for (const session of this.#sessions.values()) if (session.expiresAt <= now) this.#sessions.delete(session.id);
    if (this.#attempts.size >= 1_000 && !this.#attempts.has(remoteAddress)) throw new HttpError(429, 'LOGIN_RATE_LIMIT');
    const attempt = this.#attempts.get(remoteAddress) ?? { count: 0, until: now + 60_000 };
    this.#attempts.set(remoteAddress, attempt);
    if (++attempt.count > 10) throw new HttpError(429, 'LOGIN_RATE_LIMIT');
    if (typeof token !== 'string' || !this.acceptsToken(token)) throw new HttpError(401, 'INVALID_TOKEN');
    if (this.#sessions.size >= 64) throw new HttpError(429, 'TOO_MANY_SESSIONS');
    const session = { id: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'), expiresAt: now + SESSION_TTL };
    this.#sessions.set(session.id, session);
    return session;
  }
  session(request: IncomingMessage): AuthSession | undefined {
    const id = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    return id ? this.getSession(id) : undefined;
  }
  getSession(id: string): AuthSession | undefined {
    const session = this.#sessions.get(id);
    if (session && session.expiresAt > Date.now()) return session;
    this.#sessions.delete(id);
    return undefined;
  }
  requireSession(request: IncomingMessage): AuthSession {
    const session = this.session(request);
    if (!session) throw new HttpError(401, 'AUTH_REQUIRED');
    return session;
  }
  requireCsrf(request: IncomingMessage, session: AuthSession): void {
    if (request.headers['x-linkterm-csrf'] !== session.csrf) throw new HttpError(403, 'CSRF_REJECTED');
  }
  logout(id: string): void { this.#sessions.delete(id); }
  cookie(session?: AuthSession): string {
    return `${COOKIE_NAME}=${session?.id ?? ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${session ? Math.floor(SESSION_TTL / 1000) : 0}${this.secureCookie ? '; Secure' : ''}`;
  }
  clear(): void { this.#sessions.clear(); this.#attempts.clear(); }
}
