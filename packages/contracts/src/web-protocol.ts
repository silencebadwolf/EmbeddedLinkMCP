import { z } from 'zod';
import { CLIENT_CHANNELS } from './client-protocol.js';

export const WEB_PROTOCOL_VERSION = 'linkterm-web/1' as const;
export const WEB_REQUEST_WINDOW_MS = 5 * 60_000;
export const WEB_MAX_FRAME_BYTES = 2 * 1024 * 1024;

export const WebRequestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
  issuedAt: z.number().int().nonnegative(),
  method: z.enum(Object.values(CLIENT_CHANNELS)),
  payload: z.unknown().optional(),
}).strict();
export type WebRequest = z.infer<typeof WebRequestSchema>;

export interface WebRuntimeInfo {
  readonly id: string;
  readonly hostname: string;
  readonly platform: string;
  readonly protocol: typeof WEB_PROTOCOL_VERSION;
  readonly serverTime: number;
  readonly capabilities: {
    readonly nativeFilePicker: false;
    readonly screenshot: false;
    readonly terminalHost: 'server';
  };
}

export type WebServerFrame =
  | { type: 'hello'; protocol: typeof WEB_PROTOCOL_VERSION; clientId: string; runtime: WebRuntimeInfo }
  | { type: 'response'; id: string; result: unknown }
  | { type: 'event'; channel: string; payload: unknown };

export const WebClientFrameSchema = z.object({ type: z.literal('request'), request: WebRequestSchema }).strict();
