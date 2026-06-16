// @vitest-environment happy-dom
/**
 * useTranscript hook 单测。
 *
 * Phase 6 评审 C1 修订后验证：
 * - mount 时 **不再** 调用 session.read（subscribe 已返回历史快照）
 * - 注册 transcript.onEvent 监听
 * - 调用 session.subscribe 通知主进程开始 broadcast
 * - subscribe 返回的 events 被渲染（历史快照）
 * - emit 推送事件时调用 terminal.write（间接，通过 renderEventToXterm）
 * - destroyed envelope 触发 store.removeSession
 * - 历史快照 + 后续流式事件不重复也不丢失
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTranscript } from '../../../../src/renderer/hooks/useTranscript.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';
import type { Terminal } from '@xterm/xterm';

const resetStore = (): void => {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
  });
};

const fakeTerm = (): Pick<Terminal, 'write' | 'clear'> & { writes: string[] } => {
  const writes: string[] = [];
  return {
    write: ((data: string) => {
      writes.push(data);
    }) as Terminal['write'],
    clear: (() => undefined) as Terminal['clear'],
    writes,
  };
};

describe('useTranscript', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('does nothing when sessionId is null', () => {
    const term = fakeTerm();
    renderHook(() => useTranscript(null, term));
    expect(mock.spies.session.subscribe).not.toHaveBeenCalled();
    expect(mock.spies.session.read).not.toHaveBeenCalled();
  });

  it('subscribes without calling read (C1: snapshot comes from subscribe)', async () => {
    const term = fakeTerm();
    renderHook(() => useTranscript('sess_1', term));
    await waitFor(() => {
      expect(mock.spies.session.subscribe).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    });
    expect(mock.spies.session.read).not.toHaveBeenCalled();
  });

  it('does not render outgoing ai events but renders device events', async () => {
    const term = fakeTerm();
    renderHook(() => useTranscript('sess_1', term));
    // wait for subscribe to happen so onEvent listener is registered
    await waitFor(() => expect(mock.spies.session.subscribe).toHaveBeenCalled());

    mock.emitTranscript({
      sessionId: 'sess_1',
      event: {
        type: 'data',
        origin: 'ai',
        sequence: 1,
        timestamp: 0,
        dataBase64: btoa('hi'),
      },
    });
    expect(term.writes.join('')).toBe('');

    mock.emitTranscript({
      sessionId: 'sess_1',
      event: {
        type: 'data',
        origin: 'device',
        sequence: 2,
        timestamp: 0,
        dataBase64: btoa('hi'),
      },
    });
    expect(term.writes.join('')).not.toContain('[A]');
    expect(term.writes.join('')).toContain('hi');
  });

  it('ignores events for other sessions', async () => {
    const term = fakeTerm();
    renderHook(() => useTranscript('sess_1', term));
    await waitFor(() => expect(mock.spies.session.subscribe).toHaveBeenCalled());

    mock.emitTranscript({
      sessionId: 'sess_OTHER',
      event: {
        type: 'data',
        origin: 'human',
        sequence: 1,
        timestamp: 0,
        dataBase64: btoa('nope'),
      },
    });
    expect(term.writes.join('')).not.toContain('nope');
  });

  it('removes session from store on destroyed envelope', async () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'A',
      connectionType: 'local-shell',
      state: 'open',
    });
    const term = fakeTerm();
    renderHook(() => useTranscript('sess_1', term));
    await waitFor(() => expect(mock.spies.session.subscribe).toHaveBeenCalled());

    mock.emitTranscript({ sessionId: 'sess_1', event: null, destroyed: true });
    expect(useAppStore.getState().sessions.has('sess_1')).toBe(false);
  });

  it('updates session state on state event', async () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'A',
      connectionType: 'local-shell',
      state: 'opening',
    });
    const term = fakeTerm();
    renderHook(() => useTranscript('sess_1', term));
    await waitFor(() => expect(mock.spies.session.subscribe).toHaveBeenCalled());

    mock.emitTranscript({
      sessionId: 'sess_1',
      event: {
        type: 'state',
        origin: 'system',
        sequence: 1,
        timestamp: 0,
        meta: { from: 'opening', to: 'open' },
      },
    });
    expect(useAppStore.getState().sessions.get('sess_1')?.state).toBe('open');
  });

  // === Phase 6 评审 C1：subscribe 返回的快照 + 后续 onEvent 都到达且不重复 ===

  it('C1: subscribe events render once, subsequent onEvent appends without duplication', async () => {
    const term = fakeTerm();
    // subscribe 返回 N=2 条历史
    mock.spies.session.subscribe.mockResolvedValueOnce({
      success: true,
      data: {
        events: [
          {
            type: 'data',
            origin: 'device',
            sequence: 1,
            timestamp: 0,
            dataBase64: btoa('A'),
          },
          {
            type: 'data',
            origin: 'device',
            sequence: 2,
            timestamp: 0,
            dataBase64: btoa('B'),
          },
        ],
        cursor: 2,
        truncated: false,
        oldestAvailableSequence: 1,
      },
    });
    renderHook(() => useTranscript('sess_1', term));
    await waitFor(() => expect(mock.spies.session.subscribe).toHaveBeenCalled());
    // 等待 subscribe promise 解析后历史已渲染
    await waitFor(() => expect(term.writes.join('')).toContain('A'));
    await waitFor(() => expect(term.writes.join('')).toContain('B'));

    // 后续两条流式事件
    mock.emitTranscript({
      sessionId: 'sess_1',
      event: {
        type: 'data',
        origin: 'device',
        sequence: 3,
        timestamp: 0,
        dataBase64: btoa('C'),
      },
    });
    mock.emitTranscript({
      sessionId: 'sess_1',
      event: {
        type: 'data',
        origin: 'device',
        sequence: 4,
        timestamp: 0,
        dataBase64: btoa('D'),
      },
    });

    const out = term.writes.join('');
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toContain('C');
    expect(out).toContain('D');
    // 不重复：每个字符仅出现一次
    expect((out.match(/A/g) ?? []).length).toBe(1);
    expect((out.match(/B/g) ?? []).length).toBe(1);
    expect((out.match(/C/g) ?? []).length).toBe(1);
    expect((out.match(/D/g) ?? []).length).toBe(1);
  });
});
