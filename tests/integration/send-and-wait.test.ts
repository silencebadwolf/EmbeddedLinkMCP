import { describe, expect, it } from 'vitest';
import { LocalShellSession } from '@linkterm/runtime/transports/local-shell/index';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { sendAndWait } from '@linkterm/runtime/core/terminal-rules/send-and-wait';
import type { SessionId } from '@/shared/types.js';
import { createMockPtyFactory } from '../fixtures/mock-pty.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('Phase 7 — sendAndWait integration', () => {
  const flushImmediates = async (): Promise<void> => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  it('cross-chunk completion marker is reported as metadata over LocalShellSession + FakePty', async () => {
    const manager = new SessionManager();
    const { factory, created } = createMockPtyFactory();
    let session!: LocalShellSession;
    const sess = await manager.createAndOpen((id: SessionId) => {
      session = new LocalShellSession({
        id,
        config: { type: 'local-shell' },
        ptyFactory: factory,
      });
      return session;
    });

    const orchestrator = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: sess.id,
        payload: utf8('echo hi'),
        rules: { completionMarkers: ['DONE'], lineEnding: '\r\n' },
        timeoutMs: 1000,
      },
    );

    await flushImmediates();

    const pty = created[0]!;
    // Echo back the write across multiple small chunks (PTY emits strings)
    pty.pushIncoming('echo hi\r');
    pty.pushIncoming('\n');
    // Then real reply, with DONE marker straddling chunks
    pty.pushIncoming('hi\r\nDO');
    pty.pushIncoming('NE\r\n');

    const result = await orchestrator;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(result.matchedMarkerIndex).toBe(0);
    // received buffer should at least include DONE
    expect(new TextDecoder().decode(result.received)).toContain('DONE');

    await manager.destroyAll();
  });

  it('settle returns received bytes accumulated so far (no completion marker hit)', async () => {
    const manager = new SessionManager();
    const { factory, created } = createMockPtyFactory();
    let session!: LocalShellSession;
    const sess = await manager.createAndOpen((id: SessionId) => {
      session = new LocalShellSession({ id, config: { type: 'local-shell' }, ptyFactory: factory });
      return session;
    });

    const orchestrator = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: sess.id,
        payload: utf8('foo'),
        rules: { completionMarkers: ['NEVER'], lineEnding: '\r\n' },
        timeoutMs: 80,
      },
    );

    await flushImmediates();

    const pty = created[0]!;
    pty.pushIncoming('foo\r\n'); // echo
    pty.pushIncoming('partial output');

    const result = await orchestrator;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(result.hasDeviceOutput).toBe(true);
    expect(new TextDecoder().decode(result.received)).toContain('partial output');

    await manager.destroyAll();
  });

  it('session-closed: waitFor short-circuits when PTY exits during wait', async () => {
    const manager = new SessionManager();
    const { factory, created } = createMockPtyFactory();
    let session!: LocalShellSession;
    const sess = await manager.createAndOpen((id: SessionId) => {
      session = new LocalShellSession({ id, config: { type: 'local-shell' }, ptyFactory: factory });
      return session;
    });

    const orchestrator = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: sess.id,
        payload: utf8('foo'),
        rules: { completionMarkers: ['NEVER'] },
        timeoutMs: 5000,
      },
    );

    await flushImmediates();

    const pty = created[0]!;
    // simulate PTY exit then close, transitioning session to closed
    pty.triggerExit(0);
    await sess.close();

    const result = await orchestrator;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.reason).toBe('session-closed');

    await manager.destroyAll();
  });
});
