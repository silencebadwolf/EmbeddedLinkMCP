import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FirmwareResources, WorkspaceResources } from '../src/resources.js';

it('limits workspace browsing to server roots and persists uploaded firmware by resource ID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkterm-resources-'));
  try {
    const workspaces = await WorkspaceResources.create(dir);
    const roots = await workspaces.list();
    expect(roots.directories).toHaveLength(1);
    const root = roots.directories[0];
    const child = await workspaces.create(root.id, 'Device_A');
    expect((await workspaces.list(root.id)).directories.map(item => item.id)).toContain(child.id);
    expect(await workspaces.select(child.id)).toBe(child.path);
    expect(await workspaces.firmwareReference(child.path, 'build/app.bin')).toBe(join('build', 'app.bin'));
    await mkdir(join(child.path, 'build'));
    await writeFile(join(dir, 'outside.bin'), Buffer.from([9]));
    await symlink(join(dir, 'outside.bin'), join(child.path, 'build', 'linked.bin'), 'file');
    await expect(workspaces.firmwareReference(child.path, 'build/linked.bin')).rejects.toMatchObject({ code: 'FIRMWARE_OUTSIDE_ROOT' });
    await expect(workspaces.firmwareReference(child.path, '../escape.bin')).rejects.toMatchObject({ code: 'FIRMWARE_OUTSIDE_ROOT' });
    await expect(workspaces.requireDirectory(dir)).rejects.toMatchObject({ code: 'WORKSPACE_OUTSIDE_ROOT' });
    await expect(workspaces.create(root.id, '../escape')).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_NAME' });
    const firmware = await FirmwareResources.create(dir);
    const uploaded = await firmware.upload('image.bin', Buffer.from([1, 2, 3]));
    expect(uploaded.id).toMatch(/^resource:/u);
    expect(await readFile(await firmware.resolve(uploaded.id))).toEqual(Buffer.from([1, 2, 3]));
    await expect(firmware.resolve(uploaded.id.replace('image.bin', 'image.hex'))).rejects.toMatchObject({ code: 'FIRMWARE_UNKNOWN' });
    await expect(firmware.upload('../secret.bin', Buffer.from([1]))).rejects.toMatchObject({ code: 'INVALID_FIRMWARE_NAME' });
    const hex = Buffer.from(':020000040800F2\n:0400000001020304F2\n:00000001FF\n');
    expect((await firmware.upload('image.hex', hex)).baseAddress).toBe('0x08000000');
    await expect(firmware.upload('bad.hex', Buffer.from('not HEX'))).rejects.toMatchObject({ code: 'INVALID_FIRMWARE_IMAGE' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
