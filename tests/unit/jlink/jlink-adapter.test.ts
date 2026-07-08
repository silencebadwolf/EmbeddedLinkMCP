/**
 * JLinkAdapter：probe lifecycle 真实；非 lifecycle 方法必须先校验 probeId。
 */

import { describe, expect, it } from 'vitest';
import {
  JLinkAdapter,
  JLinkInvalidStateError,
  ProbeNotFoundError,
} from '@/jlink/index.js';
import type { CommanderScriptResult, JLinkRebootOptions, ProbeInfo } from '@/jlink/index.js';
import type { JLinkCommanderClient } from '@/jlink/segger-command-runner.js';

function commanderWithPhysicalProbes(probes: ProbeInfo[]): JLinkCommanderClient {
  return {
    async detectProbes() {
      return probes;
    },
  } as JLinkCommanderClient;
}

function commanderWithProbeReboot(calls: JLinkRebootOptions[]): JLinkCommanderClient {
  return {
    async detectProbes() {
      return [];
    },
    async rebootProbe(opts?: JLinkRebootOptions): Promise<CommanderScriptResult> {
      calls.push(opts ?? {});
      return { exitCode: 0, signal: null, stdout: 'rebooted', stderr: '' };
    },
  } as JLinkCommanderClient;
}

describe('JLinkAdapter', () => {
  describe('probe lifecycle', () => {
    it('mints a UUID v4 probeId on probeConnect', async () => {
      const a = new JLinkAdapter();
      const info = await a.probeConnect({ target: 'STM32F4' });
      expect(info.connected).toBe(true);
      expect(info.target).toBe('STM32F4');
      // RFC 4122 v4 pattern
      expect(info.probeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('rejects probeConnect when target is empty', async () => {
      const a = new JLinkAdapter();
      await expect(a.probeConnect({ target: '' })).rejects.toBeInstanceOf(
        JLinkInvalidStateError,
      );
      await expect(a.probeConnect({ target: '   ' })).rejects.toBeInstanceOf(
        JLinkInvalidStateError,
      );
    });

    it('probeStatus returns connected after connect; ProbeNotFoundError after disconnect', async () => {
      const a = new JLinkAdapter();
      const info = await a.probeConnect({ target: 'STM32F4' });
      const status = await a.probeStatus(info.probeId);
      expect(status.connected).toBe(true);
      expect(status.target).toBe('STM32F4');

      await a.probeDisconnect(info.probeId);
      await expect(a.probeStatus(info.probeId)).rejects.toBeInstanceOf(ProbeNotFoundError);
    });

    it('probeDisconnect on missing id throws ProbeNotFoundError', async () => {
      const a = new JLinkAdapter();
      await expect(a.probeDisconnect('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        ProbeNotFoundError,
      );
    });

    it('probeDetect returns empty array when Commander sees no physical probes', async () => {
      const a = new JLinkAdapter({ commander: commanderWithPhysicalProbes([]) });
      expect(await a.probeDetect()).toEqual([]);
    });

    it('probeDetect returns physical probes discovered by Commander before connect', async () => {
      const a = new JLinkAdapter({
        commander: commanderWithPhysicalProbes([
          { probeId: 'physical-0', serialNumber: '601012352', connected: false },
        ]),
      });

      await expect(a.probeDetect()).resolves.toEqual([
        { probeId: 'physical-0', serialNumber: '601012352', connected: false },
      ]);
    });

    it('probeDetect merges matching physical probes with connected handles', async () => {
      const a = new JLinkAdapter({
        commander: commanderWithPhysicalProbes([
          { probeId: 'physical-0', serialNumber: '601012352', connected: false },
          { probeId: 'physical-1', serialNumber: '601012353', connected: false },
        ]),
      });
      const connected = await a.probeConnect({ target: 'STM32F4', serialNumber: '601012352' });

      const probes = await a.probeDetect();

      expect(probes).toEqual([
        { ...connected, serialNumber: '601012352' },
        { probeId: 'physical-1', serialNumber: '601012353', connected: false },
      ]);
    });

    it('reuses an existing handle when connecting the same probe selection twice', async () => {
      const a = new JLinkAdapter({ commander: commanderWithPhysicalProbes([]) });
      const a1 = await a.probeConnect({ target: 'STM32F4', interface: 'swd', speedKHz: 4000 });
      const a2 = await a.probeConnect({ target: 'STM32F4', interface: 'swd', speedKHz: 4000 });
      expect(a2.probeId).toBe(a1.probeId);
      expect(await a.probeDetect()).toHaveLength(1);
    });

    it('retires a stale default probe handle when the target name changes', async () => {
      const a = new JLinkAdapter({ commander: commanderWithPhysicalProbes([]) });
      const stale = await a.probeConnect({ target: 'STM32H743II', interface: 'swd' });
      const current = await a.probeConnect({ target: 'STM32H743IIT6', interface: 'swd' });

      expect(current.probeId).toBe(stale.probeId);
      expect(current.target).toBe('STM32H743II');
      await expect(a.probeStatus(stale.probeId)).resolves.toEqual(current);
      await expect(a.probeDetect()).resolves.toEqual([current]);
    });

    it('keeps explicitly selected probes as distinct handles', async () => {
      const a = new JLinkAdapter({ commander: commanderWithPhysicalProbes([]) });
      const a1 = await a.probeConnect({ target: 'STM32F4', serialNumber: '11111111' });
      const a2 = await a.probeConnect({ target: 'STM32F4', serialNumber: '22222222' });
      expect(a1.probeId).not.toBe(a2.probeId);
      expect(await a.probeDetect()).toHaveLength(2);
    });

    it('jlinkReboot defaults to force and retires matching probe handles', async () => {
      const calls: JLinkRebootOptions[] = [];
      const a = new JLinkAdapter({ commander: commanderWithProbeReboot(calls) });
      const probe = await a.probeConnect({ target: 'STM32F4', serialNumber: '11111111' });

      const result = await a.jlinkReboot({ serialNumber: '11111111' });

      expect(result.stdout).toBe('rebooted');
      expect(calls).toEqual([{ force: true, serialNumber: '11111111' }]);
      await expect(a.probeStatus(probe.probeId)).rejects.toBeInstanceOf(ProbeNotFoundError);
    });
  });

  describe('non-lifecycle probe validation', () => {
    it('non-lifecycle methods first validate probeId', async () => {
      const a = new JLinkAdapter();
      await expect(a.cpuHalt('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        ProbeNotFoundError,
      );
      await expect(
        a.memoryRead('00000000-0000-4000-8000-000000000000', { address: 0, length: 4 }),
      ).rejects.toBeInstanceOf(ProbeNotFoundError);
      await expect(
        a.flashDownload('00000000-0000-4000-8000-000000000000', Buffer.alloc(4)),
      ).rejects.toBeInstanceOf(ProbeNotFoundError);
    });
  });
});
