/**
 * MCP UI surface 集成测试 —— `ui_configure` / `ui_screenshot` 端到端契约。
 *
 * 覆盖：
 * - 2 工具均注册（client.listTools 包含）
 * - sensitivity 分类对版本协商的影响
 * - UI_NOT_AVAILABLE 默认拒绝（不注入 uiBridge / getActiveWindow 时）
 * - ui_configure → uiBridge.applyPatch 调用 + evidence.dispatched 回填
 * - schema strict 拒绝敏感字段 prefill
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer, LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { UiStoreBridge, CapturableWindow } from '@/mcp/surfaces/ui/types.js';
import type { UiStatePatch } from '@/shared/preload-api.js';
import { createInMemoryMcpTransportPair } from '../../../fixtures/mock-mcp-transport.js';

interface UiHarness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  mcp: LinkTermMcpServer;
  client: Client;
  applyPatchSpy: ReturnType<typeof vi.fn>;
  getActiveWindowSpy: ReturnType<typeof vi.fn>;
}

interface SetupOpts {
  withBridge?: boolean;
  withWindow?: boolean | (() => CapturableWindow | null);
}

async function setup(opts: SetupOpts = {}): Promise<UiHarness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const applyPatchSpy = vi.fn();
  const uiBridge: UiStoreBridge = { applyPatch: (p) => applyPatchSpy(p) };

  const fakeWindow: CapturableWindow = {
    isDestroyed: () => false,
    webContents: {
      capturePage: async () => ({
        toPNG: () => Buffer.from('fake-png-bytes'),
        getSize: () => ({ width: 800, height: 600 }),
      }),
    },
  };

  let getActiveWindow: () => CapturableWindow | null;
  if (opts.withWindow === false) {
    getActiveWindow = () => null;
  } else if (typeof opts.withWindow === 'function') {
    getActiveWindow = opts.withWindow;
  } else {
    getActiveWindow = () => fakeWindow;
  }
  const getActiveWindowSpy = vi.fn(getActiveWindow);

  const { server: serverTransport, client: clientTransport } =
    createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    ...(opts.withBridge === false ? {} : { uiBridge }),
    ...(opts.withWindow === false ? {} : { getActiveWindow: getActiveWindowSpy }),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-ui-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, mcp, client, applyPatchSpy, getActiveWindowSpy };
}

async function teardown(h: UiHarness): Promise<void> {
  try {
    await h.client.close();
  } catch {
    /* ignore */
  }
  await h.mcp.stop();
  await h.manager.destroyAll();
  h.serialDiscovery.dispose();
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

describe('MCP UI surface', () => {
  let h: UiHarness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  describe('registration', () => {
    it('exposes both ui_configure and ui_screenshot', async () => {
      const list = await h.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toContain('ui_configure');
      expect(names).toContain('ui_screenshot');
    });
  });

  describe('ui_configure', () => {
    it('set_locale dispatches patch and returns evidence', async () => {
      const patch: UiStatePatch = { action: 'set_locale', locale: 'zh' };
      const out = await callTool(h.client, 'ui_configure', { patch });
      expect(out.success).toBe(true);
      expect(out.origin).toBe('ai');
      expect(h.applyPatchSpy).toHaveBeenCalledWith(patch);
      const evidence = out.evidence as { kind: string; data: { dispatched: UiStatePatch } };
      expect(evidence.kind).toBe('ui_screenshot');
      expect(evidence.data.dispatched).toEqual(patch);
    });

    it('open_connection_dialog with prefill is accepted', async () => {
      const patch: UiStatePatch = {
        action: 'open_connection_dialog',
        prefill: { type: 'serial', serialPort: '/dev/ttyUSB0', baudRate: '9600' },
      };
      const out = await callTool(h.client, 'ui_configure', { patch });
      expect(out.success).toBe(true);
      expect(h.applyPatchSpy).toHaveBeenCalledWith(patch);
    });

    it('open_connection_dialog with RTT log prefill is accepted', async () => {
      const patch: UiStatePatch = {
        action: 'open_connection_dialog',
        prefill: { type: 'rtt-log', rttRoot: 'C:/work/FNA1000', rttChannel: '0' },
      };
      const out = await callTool(h.client, 'ui_configure', { patch });

      expect(out.success).toBe(true);
      expect(h.applyPatchSpy).toHaveBeenCalledWith(patch);
    });

    it('close_connection_dialog dispatches patch', async () => {
      const out = await callTool(h.client, 'ui_configure', {
        patch: { action: 'close_connection_dialog' },
      });
      expect(out.success).toBe(true);
      expect(h.applyPatchSpy).toHaveBeenCalledTimes(1);
    });

    it('set_connection_type dispatches patch', async () => {
      const out = await callTool(h.client, 'ui_configure', {
        patch: { action: 'set_connection_type', type: 'ssh' },
      });
      expect(out.success).toBe(true);
    });

    it('set_connection_type dispatches RTT log patches', async () => {
      const out = await callTool(h.client, 'ui_configure', {
        patch: { action: 'set_connection_type', type: 'rtt-log' },
      });

      expect(out.success).toBe(true);
      expect(h.applyPatchSpy).toHaveBeenCalledWith({
        action: 'set_connection_type',
        type: 'rtt-log',
      });
    });

    it('mismatched schema version is refused (state-affecting)', async () => {
      const out = await callTool(h.client, 'ui_configure', {
        patch: { action: 'set_locale', locale: 'en' },
        clientSchemaVersion: 'wrong-version',
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('VERSION_MISMATCH');
    });

    it('matched schema version succeeds', async () => {
      const out = await callTool(h.client, 'ui_configure', {
        patch: { action: 'set_locale', locale: 'en' },
        clientSchemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      });
      expect(out.success).toBe(true);
    });
  });

  describe('ui_screenshot', () => {
    it('returns base64 PNG with width/height', async () => {
      const out = await callTool(h.client, 'ui_screenshot', {});
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: {
          mimeType: string;
          base64: string;
          width: number;
          height: number;
          byteLength: number;
        };
      }).data;
      expect(data.mimeType).toBe('image/png');
      expect(data.width).toBe(800);
      expect(data.height).toBe(600);
      expect(data.byteLength).toBeGreaterThan(0);
      expect(typeof data.base64).toBe('string');
      expect(data.base64.length).toBeGreaterThan(0);
    });

    it('read-only with mismatched version still succeeds and warns', async () => {
      const out = await callTool(h.client, 'ui_screenshot', {
        clientSchemaVersion: 'wrong-version',
      });
      expect(out.success).toBe(true);
      const meta = (out.evidence as { meta?: { warning?: string } }).meta;
      expect(meta?.warning).toMatch(/schema version mismatch/i);
    });
  });

  describe('UI_NOT_AVAILABLE default rejection', () => {
    it('ui_configure returns UI_NOT_AVAILABLE without uiBridge', async () => {
      const nullH = await setup({ withBridge: false });
      try {
        const out = await callTool(nullH.client, 'ui_configure', {
          patch: { action: 'set_locale', locale: 'en' },
        });
        expect(out.success).toBe(false);
        expect((out.error as { code: string }).code).toBe('UI_NOT_AVAILABLE');
      } finally {
        await teardown(nullH);
      }
    });

    it('ui_screenshot returns UI_NOT_AVAILABLE without active window', async () => {
      const nullH = await setup({ withWindow: false });
      try {
        const out = await callTool(nullH.client, 'ui_screenshot', {});
        expect(out.success).toBe(false);
        expect((out.error as { code: string }).code).toBe('UI_NOT_AVAILABLE');
      } finally {
        await teardown(nullH);
      }
    });

    it('ui_screenshot returns UI_NOT_AVAILABLE for a destroyed window', async () => {
      const destroyedWindow: CapturableWindow = {
        isDestroyed: () => true,
        webContents: {
          capturePage: async () => {
            throw new Error('should not be called');
          },
        },
      };
      const nullH = await setup({ withWindow: () => destroyedWindow });
      try {
        const out = await callTool(nullH.client, 'ui_screenshot', {});
        expect(out.success).toBe(false);
        expect((out.error as { code: string }).code).toBe('UI_NOT_AVAILABLE');
      } finally {
        await teardown(nullH);
      }
    });
  });
});
