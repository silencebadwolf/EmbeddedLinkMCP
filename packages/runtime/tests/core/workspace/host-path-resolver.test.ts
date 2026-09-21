import { describe, expect, it } from 'vitest';
import { createHostPathResolver } from '@linkterm/runtime/core/workspace/host-path-resolver';

describe('HostPathResolver', () => {
  it('maps WSL Linux workspace paths to Windows UNC paths on a Windows host', async () => {
    const resolver = createHostPathResolver({
      platform: 'win32',
      wslRoots: async () => [{ distroName: 'Ubuntu-24.04', linuxRoot: '/home/jianyin' }],
    });

    await expect(resolver.toHostPath('/home/jianyin/code/FNA1000')).resolves.toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\code\\FNA1000',
    );
  });

  it('maps /mnt drive paths to Windows drive paths on a Windows host', async () => {
    const resolver = createHostPathResolver({ platform: 'win32' });

    await expect(resolver.toHostPath('/mnt/c/Users/Admin/Desktop/Code/link-terminal')).resolves.toBe(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
    );
  });

  it('preserves Windows and UNC paths on a Windows host', async () => {
    const resolver = createHostPathResolver({ platform: 'win32' });

    await expect(resolver.toHostPath('C:\\Users\\Admin\\Desktop\\Code\\link-terminal')).resolves.toBe(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
    );
    await expect(resolver.toHostPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin')).resolves.toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
    );
  });

  it('keeps WSL Linux paths unchanged on non-Windows hosts', async () => {
    const resolver = createHostPathResolver({
      platform: 'linux',
      wslRoots: async () => [{ distroName: 'Ubuntu-24.04', linuxRoot: '/home/jianyin' }],
    });

    await expect(resolver.toHostPath('/home/jianyin/code/FNA1000')).resolves.toBe('/home/jianyin/code/FNA1000');
  });
});
