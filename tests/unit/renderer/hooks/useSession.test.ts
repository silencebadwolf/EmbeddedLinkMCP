// @vitest-environment happy-dom
/**
 * useSession hook 单测。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessions } from '../../../../src/renderer/hooks/useSession.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

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

describe('useSessions', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('create adds session to store and selects it', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_X', state: 'open' },
    });

    const { result } = renderHook(() => useSessions());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.create({
        config: { type: 'local-shell' },
        label: 'shell-1',
      });
    });

    expect(id).toBe('sess_X');
    expect(useAppStore.getState().sessions.has('sess_X')).toBe(true);
    expect(useAppStore.getState().activeSessionId).toBe('sess_X');
  });

  it('create returns null and skips store update on failure', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'bad' },
    });

    const { result } = renderHook(() => useSessions());
    let id: string | null = 'placeholder';
    await act(async () => {
      id = await result.current.create({
        config: { type: 'local-shell' },
      });
    });

    expect(id).toBeNull();
    expect(useAppStore.getState().sessions.size).toBe(0);
  });

  it('destroy invokes session.destroy and removes from store', async () => {
    useAppStore.getState().addSession({
      id: 'sess_Y',
      label: 'Y',
      connectionType: 'ssh',
      state: 'open',
    });

    const { result } = renderHook(() => useSessions());
    await act(async () => {
      await result.current.destroy('sess_Y');
    });

    expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_Y' });
    expect(useAppStore.getState().sessions.has('sess_Y')).toBe(false);
  });

  it('select calls store setActive', () => {
    useAppStore.getState().addSession({
      id: 'sess_Z',
      label: 'Z',
      connectionType: 'serial',
      state: 'open',
    });
    const { result } = renderHook(() => useSessions());
    act(() => {
      result.current.select('sess_Z');
    });
    expect(useAppStore.getState().activeSessionId).toBe('sess_Z');
  });
});
