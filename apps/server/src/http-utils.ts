import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string = code) { super(message); }
}

export function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

export function failure(code: string, message = code) { return { success: false as const, error: { code, message } }; }

export async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
  const declared = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
}

export async function readBytes(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') throw new HttpError(415, 'BINARY_REQUIRED');
  const declared = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}
