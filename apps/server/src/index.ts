import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { startServer } from './server.js';
import { createServerNativeBindings } from './native-bindings.js';
import { readOrCreateSecret, ServerSecretCodec } from './secret-codec.js';

const dataDir = path.resolve(process.env.LINKTERM_SERVER_DATA_DIR ?? path.join(homedir(), '.linkterm-server'));
const port = Number(process.env.LINKTERM_SERVER_PORT ?? 8711);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('LINKTERM_SERVER_PORT must be an integer between 0 and 65535');
const tokenFile = path.join(dataDir, 'access-token');
const accessToken = process.env.LINKTERM_SERVER_TOKEN ?? await readOrCreateSecret(tokenFile);
const key = Buffer.from(await readOrCreateSecret(path.join(dataDir, 'credential-key')), 'base64');
const packagedPublic = fileURLToPath(new URL('../public', import.meta.url));
const workspacePublic = fileURLToPath(new URL('../../web/dist', import.meta.url));
const publicDir = process.env.LINKTERM_WEB_DIR ?? (existsSync(packagedPublic) ? packagedPublic : workspacePublic);
const workspaceRootsRaw: unknown = process.env.LINKTERM_WORKSPACE_ROOTS ? JSON.parse(process.env.LINKTERM_WORKSPACE_ROOTS) : undefined;
if (workspaceRootsRaw !== undefined && (!Array.isArray(workspaceRootsRaw) || !workspaceRootsRaw.every(item => typeof item === 'string'))) throw new Error('LINKTERM_WORKSPACE_ROOTS must be a JSON array of absolute directory paths');
const server = await startServer({
  runtime: { dataDir, secretCodec: new ServerSecretCodec(key), nativeBindings: createServerNativeBindings() },
  accessToken, publicDir, port,
  host: process.env.LINKTERM_SERVER_HOST,
  publicOrigin: process.env.LINKTERM_PUBLIC_ORIGIN,
  devOrigin: process.env.LINKTERM_DEV_ORIGIN,
  workspaceRoots: workspaceRootsRaw as string[] | undefined,
});
console.log(`LinkTerm Web: ${server.url}\nData directory: ${dataDir}`);
if (!process.env.LINKTERM_SERVER_TOKEN) console.log(`Login token file: ${tokenFile}`);
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void server.close().then(() => { process.exitCode = 0; process.disconnect?.(); }, error => { console.error('Shutdown failed:', error); process.exitCode = 1; process.disconnect?.(); });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', message => { if (message === 'linkterm:dev:quit') stop(); });
