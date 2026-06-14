// @vitest-environment happy-dom
/**
 * useUiPatchSubscription — store action 派发测试。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUiPatchSubscription } from '../../../../src/renderer/hooks/useUiPatchSubscription.js';
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
    connectionDialogPrefill: null,
  });
};

describe('useUiPatchSubscription', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('set_locale dispatches into store', () => {
    renderHook(() => useUiPatchSubscription());
    mock.emitUiPatch({ action: 'set_locale', locale: 'zh' });
    expect(useAppStore.getState().locale).toBe('zh');
  });

  it('open_connection_dialog with prefill writes prefill and opens dialog', () => {
    renderHook(() => useUiPatchSubscription());
    mock.emitUiPatch({
      action: 'open_connection_dialog',
      prefill: { type: 'ssh', sshHost: '10.0.0.1' },
    });
    const state = useAppStore.getState();
    expect(state.dialogOpen).toBe(true);
    expect(state.connectionDialogPrefill).toEqual({ type: 'ssh', sshHost: '10.0.0.1' });
  });

  it('open_connection_dialog without prefill clears any stale prefill', () => {
    useAppStore.setState({ connectionDialogPrefill: { sshHost: 'old' } });
    renderHook(() => useUiPatchSubscription());
    mock.emitUiPatch({ action: 'open_connection_dialog' });
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
    expect(useAppStore.getState().dialogOpen).toBe(true);
  });

  it('close_connection_dialog closes and clears prefill', () => {
    useAppStore.setState({
      dialogOpen: true,
      connectionDialogPrefill: { sshHost: 'h' },
    });
    renderHook(() => useUiPatchSubscription());
    mock.emitUiPatch({ action: 'close_connection_dialog' });
    expect(useAppStore.getState().dialogOpen).toBe(false);
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
  });

  it('set_connection_type writes prefill.type only', () => {
    renderHook(() => useUiPatchSubscription());
    mock.emitUiPatch({ action: 'set_connection_type', type: 'local-shell' });
    expect(useAppStore.getState().connectionDialogPrefill).toEqual({ type: 'local-shell' });
    expect(useAppStore.getState().dialogOpen).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useUiPatchSubscription());
    unmount();
    mock.emitUiPatch({ action: 'set_locale', locale: 'zh' });
    expect(useAppStore.getState().locale).toBe('en');
  });
});
