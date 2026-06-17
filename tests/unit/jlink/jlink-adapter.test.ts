/**
 * JLinkAdapter：probe lifecycle 真实；非 lifecycle 方法必须先校验 probeId。
 */

import { describe, expect, it } from 'vitest';
import {
  JLinkAdapter,
  JLinkInvalidStateError,
  ProbeNotFoundError,
} from '@/jlink/index.js';

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

    it('probeDetect returns empty array (Phase 9 stub)', async () => {
      const a = new JLinkAdapter();
      expect(await a.probeDetect()).toEqual([]);
    });

    it('multiple connects produce distinct ids', async () => {
      const a = new JLinkAdapter();
      const a1 = await a.probeConnect({ target: 'STM32F4' });
      const a2 = await a.probeConnect({ target: 'STM32F4' });
      expect(a1.probeId).not.toBe(a2.probeId);
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
