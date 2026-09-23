import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('..', import.meta.url));

function within(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`);
}

/** Give each development host its own physical native dependency tree. */
export async function prepareDevNative(host) {
  if (host !== 'desktop' && host !== 'server') throw new Error(`Unsupported native host: ${host}`);
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('Start development with the pinned pnpm workspace command');
  const stagingRoot = join(workspace, '.artifacts');
  await mkdir(stagingRoot, { recursive: true });
  const temporary = await mkdtemp(join(stagingRoot, `dev-native-${host}-`));
  const deployed = join(temporary, 'app');
  const cleanup = async () => {
    const workspaceRoot = await realpath(workspace);
    const target = await realpath(temporary).catch(() => undefined);
    if (!target) return;
    if (!within(workspaceRoot, target) || !within(await realpath(stagingRoot), target))
      throw new Error(`Refusing to remove a native staging directory outside the workspace: ${target}`);
    await rm(target, { recursive: true, force: true });
  };
  try {
    const child = spawn(process.execPath, [pnpm, '--filter', `@linkterm/${host}`, 'deploy', '--prod', '--frozen-lockfile', '--package-import-method=copy', deployed], {
      cwd: workspace, stdio: 'inherit', windowsHide: true,
    });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Native ${host} deployment failed (${code})`);
    const requireNative = createRequire(join(deployed, 'package.json'));
    const physicalRoot = await realpath(deployed);
    for (const name of ['node-pty', 'serialport']) {
      const modulePath = await realpath(requireNative.resolve(name));
      if (!within(physicalRoot, modulePath)) throw new Error(`${name} resolves outside the isolated ${host} directory`);
    }
    return { root: deployed, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
