/**
 * NullJLinkBackend：所有方法均抛 NoBackendError。
 *
 * 用一个 method-name 列表循环验证，避免漏测。新增接口方法时若没有同步 NullBackend，
 * 该测试会立即失败（漏方法 → 调用 undefined）。
 */

import { describe, expect, it } from 'vitest';
import { NullJLinkBackend, NoBackendError } from '@/jlink/index.js';

const NO_ARG_METHODS = ['probeDetect'] as const;

const PROBE_ARG_METHODS = [
  'probeDisconnect',
  'probeStatus',
  'cpuHalt',
  'cpuRun',
  'cpuStep',
  'breakpointList',
  'registerList',
  'gdbServerStop',
  'crashDiagnose',
] as const;

describe('NullJLinkBackend', () => {
  const backend = new NullJLinkBackend();

  it.each(NO_ARG_METHODS)('rejects %s with NoBackendError', async (m) => {
    const fn = backend[m].bind(backend) as () => Promise<unknown>;
    await expect(fn()).rejects.toBeInstanceOf(NoBackendError);
  });

  it.each(PROBE_ARG_METHODS)('rejects %s(probeId) with NoBackendError', async (m) => {
    const fn = backend[m].bind(backend) as (id: string) => Promise<unknown>;
    await expect(fn('any-probe-id')).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects probeConnect with NoBackendError', async () => {
    await expect(backend.probeConnect({ target: 'STM32F4' })).rejects.toBeInstanceOf(
      NoBackendError,
    );
  });

  it('rejects jlinkReboot with NoBackendError', async () => {
    await expect(backend.jlinkReboot()).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects cpuReset with NoBackendError', async () => {
    await expect(backend.cpuReset('p', { halt: true })).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects breakpointSet/clear with NoBackendError', async () => {
    await expect(backend.breakpointSet('p', 0x100)).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.breakpointClear('p', 1)).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects registerRead/Write with NoBackendError', async () => {
    await expect(backend.registerRead('p', 'r0')).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.registerWrite('p', 'r0', 0)).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects memoryRead/Write with NoBackendError', async () => {
    await expect(backend.memoryRead('p', { address: 0, length: 4 })).rejects.toBeInstanceOf(
      NoBackendError,
    );
    await expect(backend.memoryWrite('p', 0, Buffer.alloc(4))).rejects.toBeInstanceOf(
      NoBackendError,
    );
  });

  it('rejects flash family with NoBackendError', async () => {
    await expect(backend.flashDownload('p', Buffer.alloc(4))).rejects.toBeInstanceOf(
      NoBackendError,
    );
    await expect(backend.flashErase('p')).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.flashWrite('p', 0, Buffer.alloc(4))).rejects.toBeInstanceOf(
      NoBackendError,
    );
    await expect(backend.flashVerify('p', Buffer.alloc(4))).rejects.toBeInstanceOf(
      NoBackendError,
    );
  });

  it('rejects RTT family with NoBackendError', async () => {
    await expect(backend.rttConnect('p')).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.rttRead('p', 0, 1)).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.rttWrite('p', 0, Buffer.from('x'))).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.rttClear('p', 0)).rejects.toBeInstanceOf(NoBackendError);
    await expect(backend.rttSearch('p', 0, 'x', 1)).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects gdbServerStart with NoBackendError', async () => {
    await expect(backend.gdbServerStart('p')).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects runCommanderScript with NoBackendError', async () => {
    await expect(backend.runCommanderScript('p', ['r'])).rejects.toBeInstanceOf(NoBackendError);
  });

  it('rejects snapshotCapture with NoBackendError', async () => {
    await expect(
      backend.snapshotCapture('p', [{ address: 0, length: 4 }]),
    ).rejects.toBeInstanceOf(NoBackendError);
  });

  it('NoBackendError exposes stable code field', async () => {
    try {
      await backend.probeDetect();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NoBackendError);
      expect((err as NoBackendError).code).toBe('NO_BACKEND');
    }
  });
});
