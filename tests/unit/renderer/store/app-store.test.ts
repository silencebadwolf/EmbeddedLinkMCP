// @vitest-environment happy-dom
/**
 * Zustand store 单测。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, selectSessionIds, selectActiveSession } from '../../../../src/renderer/store/app-store.js';

const reset = (): void => {
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

describe('useAppStore', () => {
  beforeEach(reset);

  it('addSession sets session and auto-selects when no active', () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'A',
      connectionType: 'serial',
      state: 'idle',
    });
    const state = useAppStore.getState();
    expect(state.sessions.size).toBe(1);
    expect(state.activeSessionId).toBe('sess_1');
  });

  it('addSession does not change active when active already set', () => {
    const { addSession, setActive } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'A', connectionType: 'serial', state: 'idle' });
    setActive('sess_1');
    addSession({ id: 'sess_2', label: 'B', connectionType: 'ssh', state: 'idle' });
    expect(useAppStore.getState().activeSessionId).toBe('sess_1');
  });

  it('removeSession reassigns active to first remaining', () => {
    const { addSession, removeSession } = useAppStore.getState();
    addSession({ id: 's1', label: 'A', connectionType: 'serial', state: 'idle' });
    addSession({ id: 's2', label: 'B', connectionType: 'ssh', state: 'idle' });
    removeSession('s1');
    expect(useAppStore.getState().activeSessionId).toBe('s2');
  });

  it('removeSession sets active to null when last removed', () => {
    const { addSession, removeSession } = useAppStore.getState();
    addSession({ id: 's1', label: 'A', connectionType: 'serial', state: 'idle' });
    removeSession('s1');
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it('updateSessionState changes state in-place', () => {
    const { addSession, updateSessionState } = useAppStore.getState();
    addSession({ id: 's1', label: 'A', connectionType: 'serial', state: 'idle' });
    updateSessionState('s1', 'open');
    expect(useAppStore.getState().sessions.get('s1')?.state).toBe('open');
  });

  it('updateSessionState noop for unknown id', () => {
    useAppStore.getState().updateSessionState('missing', 'open');
    expect(useAppStore.getState().sessions.size).toBe(0);
  });

  it('setLocale toggles locale', () => {
    useAppStore.getState().setLocale('zh');
    expect(useAppStore.getState().locale).toBe('zh');
  });

  it('openDialog/closeDialog toggle dialogOpen', () => {
    const { openDialog, closeDialog } = useAppStore.getState();
    openDialog();
    expect(useAppStore.getState().dialogOpen).toBe(true);
    closeDialog();
    expect(useAppStore.getState().dialogOpen).toBe(false);
  });

  it('markOriginActivity records timestamp and updates SessionMeta', () => {
    const { addSession, markOriginActivity } = useAppStore.getState();
    addSession({ id: 's1', label: 'A', connectionType: 'serial', state: 'open' });
    markOriginActivity('s1', 'ai', 12345);
    const meta = useAppStore.getState().sessions.get('s1');
    expect(meta?.lastOrigin).toBe('ai');
    expect(meta?.lastOriginAt).toBe(12345);
    expect(useAppStore.getState().originActivity['s1']?.ai).toBe(12345);
  });

  it('selectors expose ids and active session meta', () => {
    const { addSession, setActive } = useAppStore.getState();
    addSession({ id: 's1', label: 'A', connectionType: 'serial', state: 'idle' });
    addSession({ id: 's2', label: 'B', connectionType: 'ssh', state: 'idle' });
    setActive('s2');
    const state = useAppStore.getState();
    expect(selectSessionIds(state)).toEqual(['s1', 's2']);
    expect(selectActiveSession(state)?.id).toBe('s2');
  });

  it('setConnectionDialogPrefill stores prefill object', () => {
    useAppStore.getState().setConnectionDialogPrefill({ type: 'serial', baudRate: '9600' });
    expect(useAppStore.getState().connectionDialogPrefill).toEqual({
      type: 'serial',
      baudRate: '9600',
    });
  });

  it('setConnectionDialogPrefill(null) resets to null', () => {
    useAppStore.getState().setConnectionDialogPrefill({ type: 'ssh' });
    useAppStore.getState().setConnectionDialogPrefill(null);
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
  });
});
