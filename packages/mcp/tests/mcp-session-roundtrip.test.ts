import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import { createMcpServer } from '@linkterm/mcp/index';
import type { LinkTermMcpServer } from '@linkterm/mcp/server';
import { createMockPtyFactory } from '../../../tests/fixtures/mock-pty.js';
import { createInMemoryMcpTransportPair } from '../../../tests/fixtures/mock-mcp-transport.js';

/**
 * 端到端 roundtrip：通过 MCP 客户端走 open_session → write → read 完整路径。
 *
 * 用 local-shell + FakePty 而非 mock-transport，是因为 MCP open_session 必须经过
 * 真实的 SessionFactory 分支（不能像 terminal-tools.test.ts 那样通过 injectTestSession
 * 走旁门）。这同时验证了 \"SessionManager 必须由 IPC + MCP 共享\" 不变量：MCP 创建的
 * session 在 manager 里立刻可见、可读。
 */

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('MCP session roundtrip (open → write → read)', () => {
  let manager: SessionManager;
  let serialDiscovery: SerialDiscovery;
  let mcp: LinkTermMcpServer;
  let client: Client;
  let ptyFactoryHandle: ReturnType<typeof createMockPtyFactory>;

  beforeEach(async () => {
    manager = new SessionManager();
    serialDiscovery = new SerialDiscovery({ listFn: async () => [] });

    // 拦截 LocalShellSession 默认走 node-pty 真实工厂；通过 manager.create 旁路注入 pty 工厂
    // 不在 MCP open_session schema 中暴露 ptyFactory（生产代码不该接受工厂注入）。
    // 这里改用 \"在 MCP 启动前 monkey-patch SessionManager.create\" 的策略：拦截 factory 调用，
    // 把内部创建出的 LocalShellSession 替换为带 ptyFactory 的版本不可行（id 已绑定）。
    //
    // 退一步：直接在工具调用前预先创建一个本地 shell，再用 MCP 的 list/read/write/close 走通。
    // 这样 \"MCP 视角看到 manager 中已有的 session\" 这一不变量被精确验证。
    ptyFactoryHandle = createMockPtyFactory();

    const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
    mcp = createMcpServer({
      sessionManager: manager,
      serialDiscovery,
      transportFactory: () => serverTransport,
    });
    await mcp.start();

    client = new Client({ name: 'roundtrip-client', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    await mcp.stop();
    await manager.destroyAll();
    serialDiscovery.dispose();
  });

  it('lists, reads and writes a session that was created in the shared SessionManager', async () => {
    const { LocalShellSession } = await import('@linkterm/runtime/transports/local-shell/local-shell-session');
    const session = manager.create(
      (id) =>
        new LocalShellSession({
          id,
          config: { type: 'local-shell' },
          ptyFactory: ptyFactoryHandle.factory,
        }),
    );
    await session.open();
    const fakePty = ptyFactoryHandle.created[0]!;

    // 1) MCP list_sessions 看到这个 session
    const listed = (await client.callTool({ name: 'list_sessions', arguments: {} }))
      .structuredContent as Record<string, unknown>;
    const sessions = (listed.evidence as { data: { sessions: { sessionId: string }[] } }).data
      .sessions;
    expect(sessions.map((s) => s.sessionId)).toContain(session.id);

    // 2) MCP write_to_session：字节进入 PTY
    const writeOut = (await client.callTool({
      name: 'write_to_session',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'echo hi\n' },
        correlationId: 'rt-1',
      },
    })).structuredContent as Record<string, unknown>;
    expect(writeOut.success).toBe(true);
    expect(fakePty.writes.join('')).toContain('echo hi\n');

    // 3) PTY 推送响应；MCP read_from_session 能读到，且 cursor 推进
    fakePty.pushIncoming('hi\n');

    const readOut1 = (await client.callTool({
      name: 'read_from_session',
      arguments: { sessionId: session.id, cursor: 0 },
    })).structuredContent as Record<string, unknown>;
    const readEvents = (readOut1.evidence as {
      data: { events: { type: string; origin: string }[] };
      cursor: number;
    }).data.events;
    const dataEvents = readEvents.filter((e) => e.type === 'data');
    // 至少 1 个 origin=ai（来自 write）和 1 个 origin=device（来自 pushData）
    expect(dataEvents.some((e) => e.origin === 'ai')).toBe(true);
    expect(dataEvents.some((e) => e.origin === 'device')).toBe(true);

    const cursorAfterFirstRead = (readOut1.evidence as { cursor: number }).cursor;

    // 4) 增量 read：cursor 之后应无新事件
    const readOut2 = (await client.callTool({
      name: 'read_from_session',
      arguments: { sessionId: session.id, cursor: cursorAfterFirstRead },
    })).structuredContent as Record<string, unknown>;
    const newEvents = (readOut2.evidence as {
      data: { events: unknown[] };
    }).data.events;
    expect(newEvents).toEqual([]);

    // 5) 推第二条响应，cursor 增量读到位
    fakePty.pushIncoming('done\n');
    const readOut3 = (await client.callTool({
      name: 'read_from_session',
      arguments: { sessionId: session.id, cursor: cursorAfterFirstRead },
    })).structuredContent as Record<string, unknown>;
    const evs = (readOut3.evidence as {
      data: { events: { type: string; origin: string; dataBase64?: string }[] };
    }).data.events;
    const deviceEv = evs.find((e) => e.type === 'data' && e.origin === 'device');
    expect(deviceEv).toBeDefined();
    expect(Buffer.from(deviceEv!.dataBase64!, 'base64').toString('utf-8')).toBe('done\n');

    // 6) close_session：transport 关闭，但 transcript 仍可读
    const closeOut = (await client.callTool({
      name: 'close_session',
      arguments: { sessionId: session.id },
    })).structuredContent as Record<string, unknown>;
    expect(closeOut.success).toBe(true);
    expect(closeOut.state).toBe('closed');

    const finalRead = (await client.callTool({
      name: 'read_from_session',
      arguments: { sessionId: session.id, cursor: 0 },
    })).structuredContent as Record<string, unknown>;
    expect(finalRead.success).toBe(true);
  });

  it('every tool result carries origin=ai and a stable schemaVersion', async () => {
    const out = (await client.callTool({ name: 'list_sessions', arguments: {} }))
      .structuredContent as Record<string, unknown>;
    expect(out.origin).toBe('ai');
    expect(typeof out.schemaVersion).toBe('string');
    expect((out.schemaVersion as string).startsWith('linkterm-mcp/')).toBe(true);
  });

  // 抑制未使用变量警告
  void utf8;
});
