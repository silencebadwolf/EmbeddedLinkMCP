import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceConfigManager,
} from '@linkterm/runtime/core/workspace/index';
import { createMcpServer } from '@linkterm/mcp/index';
import type { LinkTermMcpServer } from '@linkterm/mcp/server';
import type { SerialPortInfo } from '@/shared/types.js';
import { createInMemoryMcpTransportPair } from '../../../tests/fixtures/mock-mcp-transport.js';

interface Harness {
  manager: SessionManager;
  workspaceConfigManager: WorkspaceConfigManager;
  serialDiscovery: SerialDiscovery;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
  ports: SerialPortInfo[];
}

async function setup(opts: { ports?: SerialPortInfo[] } = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-ws-mcp-'));
  const ports: SerialPortInfo[] = opts.ports ?? [];
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({
    listFn: async () => ports as readonly SerialPortInfo[],
  });
  const workspaceConfigManager = new WorkspaceConfigManager({
    evidenceFn: async () => ({ serialPorts: ports }),
  });
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({ serialPorts: ports }),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, workspaceConfigManager, serialDiscovery, mcp, client, root, ports };
}

async function teardown(h: Harness): Promise<void> {
  try {
    await h.client.close();
  } catch {
    /* ignore */
  }
  await h.mcp.stop();
  await h.manager.destroyAll();
  h.serialDiscovery.dispose();
  await rm(h.root, { recursive: true, force: true });
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

describe('MCP workspace tools', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  describe('init_workspace', () => {
    it('creates workspace and returns evidence with workspace_config kind', async () => {
      const out = await callTool(h.client, 'init_workspace', { root: h.root });
      expect(out.success).toBe(true);
      expect(out.origin).toBe('ai');
      const evidence = out.evidence as { kind: string; data: { config: { schemaVersion: string } } };
      expect(evidence.kind).toBe('workspace_config');
      expect(evidence.data.config.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    });

    it('returns WORKSPACE_ALREADY_INITIALIZED on second init without force', async () => {
      await callTool(h.client, 'init_workspace', { root: h.root });
      const out = await callTool(h.client, 'init_workspace', { root: h.root });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('WORKSPACE_ALREADY_INITIALIZED');
    });

    it('force=true overwrites existing workspace', async () => {
      await callTool(h.client, 'init_workspace', { root: h.root });
      const out = await callTool(h.client, 'init_workspace', { root: h.root, force: true });
      expect(out.success).toBe(true);
    });

    it('rejects missing root at SDK schema layer', async () => {
      // SDK validates outer schema before our handler runs; missing required field returns isError.
      const res = await h.client.callTool({ name: 'init_workspace', arguments: {} });
      expect(res.isError).toBe(true);
    });
  });

  describe('get_workspace_config', () => {
    it('returns WORKSPACE_NOT_FOUND when no root and no current workspace', async () => {
      const out = await callTool(h.client, 'get_workspace_config', {});
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns WORKSPACE_NOT_FOUND for non-existent root', async () => {
      const out = await callTool(h.client, 'get_workspace_config', {
        root: path.join(h.root, 'does-not-exist'),
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('WORKSPACE_NOT_FOUND');
    });

    it('returns config with missingFields after init', async () => {
      await callTool(h.client, 'init_workspace', { root: h.root });
      const out = await callTool(h.client, 'get_workspace_config', { root: h.root });
      expect(out.success).toBe(true);
      const evidence = out.evidence as {
        kind: string;
        meta: { missingFields: string[]; conflicts: unknown[] };
      };
      expect(evidence.kind).toBe('workspace_config');
      expect(evidence.meta.missingFields).toEqual(['chip', 'flash', 'debug', 'rtt', 'serial']);
      expect(evidence.meta.conflicts).toEqual([]);
    });

    it('falls back to current workspace when root omitted', async () => {
      await callTool(h.client, 'init_workspace', { root: h.root });
      const out = await callTool(h.client, 'get_workspace_config', {});
      expect(out.success).toBe(true);
      const evidence = out.evidence as { data: { root: string } };
      expect(evidence.data.root).toBe(h.root);
    });
  });

  describe('update_workspace_config', () => {
    beforeEach(async () => {
      await callTool(h.client, 'init_workspace', { root: h.root });
    });

    it('persists chip section and reports missingFields', async () => {
      const out = await callTool(h.client, 'update_workspace_config', {
        root: h.root,
        patch: { chip: { family: 'STM32F4', part: 'STM32F407' } },
      });
      expect(out.success).toBe(true);
      const evidence = out.evidence as {
        data: { config: { chip: unknown } };
        meta: { missingFields: string[]; persisted: boolean };
      };
      expect(evidence.data.config.chip).toEqual({ family: 'STM32F4', part: 'STM32F407' });
      expect(evidence.meta.persisted).toBe(true);
      expect(evidence.meta.missingFields).toEqual(['flash', 'debug', 'rtt', 'serial']);
    });

    it('validateOnly=true does not persist', async () => {
      const out = await callTool(h.client, 'update_workspace_config', {
        root: h.root,
        patch: { chip: { family: 'STM32F4', part: 'X' } },
        validateOnly: true,
      });
      expect(out.success).toBe(true);
      expect((out.evidence as { meta: { persisted: boolean } }).meta.persisted).toBe(false);
      // 重新读取应该看不到 chip
      const get = await callTool(h.client, 'get_workspace_config', { root: h.root });
      const cfg = (get.evidence as { data: { config: { chip?: unknown } } }).data.config;
      expect(cfg.chip).toBeUndefined();
    });

    it('reports serial.port conflict when port not in evidence', async () => {
      const out = await callTool(h.client, 'update_workspace_config', {
        root: h.root,
        patch: { serial: { port: '/dev/missing', baudRate: 115200, mode: 'terminal' } },
      });
      expect(out.success).toBe(true);
      const conflicts = (out.evidence as { meta: { conflicts: { field: string }[] } }).meta
        .conflicts;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.field).toBe('serial.port');
    });

    it('rejects unknown patch keys (password) at SDK schema layer', async () => {
      // SDK 在 outer schema 阶段直接拒绝未知键；返回 isError=true，凭据不进入 handler。
      const res = await h.client.callTool({
        name: 'update_workspace_config',
        arguments: {
          root: h.root,
          patch: { credentials: { password: 'leak' } },
        },
      });
      expect(res.isError).toBe(true);
    });

    it('rejects nested unknown key inside chip patch at SDK schema layer', async () => {
      const res = await h.client.callTool({
        name: 'update_workspace_config',
        arguments: {
          root: h.root,
          patch: { chip: { family: 'STM32F4', part: 'X', password: 'leak' } },
        },
      });
      expect(res.isError).toBe(true);
    });

    it('returns WORKSPACE_NOT_FOUND when updating non-initialized workspace', async () => {
      const otherRoot = await mkdtemp(path.join(tmpdir(), 'lt-ws-other-'));
      try {
        const out = await callTool(h.client, 'update_workspace_config', {
          root: otherRoot,
          patch: { chip: { family: 'STM32F4', part: 'X' } },
        });
        expect(out.success).toBe(false);
        expect((out.error as { code: string }).code).toBe('WORKSPACE_NOT_FOUND');
      } finally {
        await rm(otherRoot, { recursive: true, force: true });
      }
    });

    it('does not echo patch values in error details (no credential leak)', async () => {
      const sensitive = 'super-secret-value';
      // SDK schema 拒绝 unknown keys；返回 isError 时 content 包含 path/message 但**不**包含 caller value。
      const res = await h.client.callTool({
        name: 'update_workspace_config',
        arguments: {
          root: h.root,
          patch: { chip: { family: 'STM32F4', part: 'X', secret: sensitive } as never },
        },
      });
      expect(res.isError).toBe(true);
      const text = JSON.stringify(res);
      expect(text).not.toContain(sensitive);
    });
  });
});
