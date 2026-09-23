#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.argv[2];
if (!['desktop', 'web', 'server'].includes(target)) throw new Error('Expected desktop, web or server');

async function run(program, args) {
  const child = spawn(process.execPath, [program, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${program} failed (${code})`);
}

if (target !== 'server') await run(join(root, 'scripts/copy-ui-assets.mjs'), []);
await run(join(root, 'node_modules/typescript/bin/tsc'), ['-b', `apps/${target}`]);
if (target !== 'server') {
  await run(join(root, 'node_modules/vite/bin/vite.js'), ['build', '--config', `apps/${target}/vite.config.ts`]);
}
