import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { HttpError } from './http-utils.js';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
export async function serveStatic(directory: string, pathname: string, response: ServerResponse): Promise<void> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'INVALID_PATH'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.'))) throw new HttpError(404, 'NOT_FOUND');
  const root = await realpath(directory);
  let file: string;
  try { file = await realpath(resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`)); }
  catch { throw new HttpError(404, 'NOT_FOUND'); }
  const child = relative(root, file);
  if (child.startsWith('..') || isAbsolute(child) || !(await stat(file)).isFile()) throw new HttpError(404, 'NOT_FOUND');
  const contentType = types[extname(file)];
  if (!contentType) throw new HttpError(404, 'NOT_FOUND');
  response.writeHead(200, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  response.once('close', () => stream.destroy());
  stream.pipe(response);
}
