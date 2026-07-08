// @vitest-environment happy-dom
/**
 * useSessionHydration hook 单测.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

describe('useSessionHydration', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates backend-created sessions into the renderer store', async () => {
    mock.spies.session.list.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [
          {
            sessionId: 'sess_ai_created',
            label: 'COM6',
            connectionType: 'serial',
            state: 'open',
          },
        ],
      },
    } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    const state = useAppStore.getState();
    expect(state.sessions.get('sess_ai_created')).toEqual({
      id: 'sess_ai_created',
      label: 'COM6',
      connectionType: 'serial',
      state: 'open',
    });
    expect(state.activeSessionId).toBe('sess_ai_created');
  });

  it('adds backend sessions created after the initial hydration snapshot', async () => {
    mock.spies.session.list.mockResolvedValueOnce({
      success: true,
      data: { sessions: [] },
    } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mock.emitSessionLifecycle({
        type: 'created',
        session: {
          sessionId: 'sess_mcp_later',
          label: 'AI serial',
          connectionType: 'serial',
          state: 'open',
          createdBy: 'ai',
        },
      });
    });

    expect(useAppStore.getState().sessions.get('sess_mcp_later')).toEqual({
      id: 'sess_mcp_later',
      label: 'AI serial',
      connectionType: 'serial',
      state: 'open',
    });
  });

  it('updates inactive session state from lifecycle events', async () => {
    mock.spies.session.list.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [
          {
            sessionId: 'sess_active',
            label: 'Active',
            connectionType: 'local-shell',
            state: 'open',
          },
          {
            sessionId: 'sess_inactive',
            label: 'Inactive',
            connectionType: 'serial',
            state: 'open',
          },
        ],
      },
    } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mock.emitSessionLifecycle({
        type: 'stateChanged',
        session: {
          sessionId: 'sess_inactive',
          label: 'Inactive',
          connectionType: 'serial',
          state: 'closed',
        },
      });
    });

    expect(useAppStore.getState().sessions.get('sess_inactive')?.state).toBe('closed');
    expect(useAppStore.getState().activeSessionId).toBe('sess_active');
  });

  it('hydrates RTT log session metadata into the renderer store', async () => {
    mock.spies.session.list.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [
          {
            sessionId: 'sess_rtt_hydrated',
            label: 'RTT ch0',
            connectionType: 'rtt-log',
            state: 'open',
            rttLog: { probeId: 'probe-1', channelIndex: 0 },
          },
        ],
      },
    } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().sessions.get('sess_rtt_hydrated')).toEqual({
      id: 'sess_rtt_hydrated',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });
  });

  it('selects an AI-created RTT log session so MCP observation is immediately visible', async () => {
    mock.spies.session.list.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [
          {
            sessionId: 'sess_serial_active',
            label: 'COM6',
            connectionType: 'serial',
            state: 'open',
          },
        ],
      },
    } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().activeSessionId).toBe('sess_serial_active');

    act(() => {
      mock.emitSessionLifecycle({
        type: 'created',
        session: {
          sessionId: 'sess_ai_rtt',
          label: 'RTT ch0',
          connectionType: 'rtt-log',
          state: 'open',
          createdBy: 'ai',
          rttLog: { probeId: 'probe-1', channelIndex: 0 },
        },
      });
    });

    expect(useAppStore.getState().sessions.get('sess_ai_rtt')).toEqual({
      id: 'sess_ai_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });
    expect(useAppStore.getState().activeSessionId).toBe('sess_ai_rtt');
  });

  it('periodically reconciles missed MCP-created RTT sessions into the App store', async () => {
    vi.useFakeTimers();
    mock.spies.session.list
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [] },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'sess_missed_rtt',
              label: 'Missed RTT ch0',
              connectionType: 'rtt-log',
              state: 'open',
              createdBy: 'ai',
              rttLog: { probeId: 'probe-2', channelIndex: 0 },
            },
          ],
        },
      } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().sessions.has('sess_missed_rtt')).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(useAppStore.getState().sessions.get('sess_missed_rtt')).toEqual({
      id: 'sess_missed_rtt',
      label: 'Missed RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-2', channelIndex: 0 },
    });
    expect(useAppStore.getState().activeSessionId).toBe('sess_missed_rtt');
  });

  it('does not reactivate an already-known AI-created session during periodic reconciliation', async () => {
    vi.useFakeTimers();
    mock.spies.session.list
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'sess_ai_rtt',
              label: 'RTT ch0',
              connectionType: 'rtt-log',
              state: 'open',
              createdBy: 'ai',
              rttLog: { probeId: 'probe-1', channelIndex: 0 },
            },
            {
              sessionId: 'sess_manual_serial',
              label: 'COM6',
              connectionType: 'serial',
              state: 'open',
            },
          ],
        },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            {
              sessionId: 'sess_ai_rtt',
              label: 'RTT ch0',
              connectionType: 'rtt-log',
              state: 'open',
              createdBy: 'ai',
              rttLog: { probeId: 'probe-1', channelIndex: 0 },
            },
            {
              sessionId: 'sess_manual_serial',
              label: 'COM6',
              connectionType: 'serial',
              state: 'open',
            },
          ],
        },
      } as never);

    const { useSessionHydration } = await import(
      '../../../../src/renderer/hooks/useSessionHydration.js'
    );

    renderHook(() => useSessionHydration());

    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().activeSessionId).toBe('sess_ai_rtt');

    act(() => {
      useAppStore.getState().setActive('sess_manual_serial');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(useAppStore.getState().activeSessionId).toBe('sess_manual_serial');
  });
});
