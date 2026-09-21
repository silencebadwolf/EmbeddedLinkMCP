// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRuntimeReadinessState } from '@linkterm/ui/features/readiness/useRuntimeReadinessState';
import { installMockPreload, type MockPreloadAPI } from '../../../../tests/fixtures/mock-preload-api.js';

const READINESS_CURSOR_STORAGE_KEY = 'linkterm:readiness-cursor';

describe('useRuntimeReadinessState', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    sessionStorage.clear();
    mock = installMockPreload();
  });

  it('reports corrupt stored readiness cursor safely and subscribes fresh', async () => {
    const snapshot = mock.readinessSnapshot(1);
    mock.setReadinessSnapshot(snapshot);
    sessionStorage.setItem(READINESS_CURSOR_STORAGE_KEY, '{"generation":-1,"secret":"raw"}');

    const { result } = renderHook(() => useRuntimeReadinessState());

    await waitFor(() => expect(result.current.snapshot?.generation).toBe(1));
    expect(mock.spies.readiness.subscribe).toHaveBeenCalledWith({});
    expect(result.current.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'readiness.preferences.corrupt', severity: 'warning' }),
    );
    expect(JSON.stringify(result.current)).not.toContain('secret');
  });

  it('stores the latest cursor and ignores events after unmount cleanup', async () => {
    const first = mock.readinessSnapshot(1);
    const second = mock.readinessSnapshot(2);
    const third = mock.readinessSnapshot(3);
    mock.setReadinessSnapshot(first);

    const { result, unmount } = renderHook(() => useRuntimeReadinessState());

    await waitFor(() => expect(result.current.snapshot?.generation).toBe(1));
    expect(sessionStorage.getItem(READINESS_CURSOR_STORAGE_KEY)).toContain('readiness_1');

    act(() => {
      mock.emitReadinessEvent(second);
    });
    await waitFor(() => expect(result.current.snapshot?.generation).toBe(2));
    expect(sessionStorage.getItem(READINESS_CURSOR_STORAGE_KEY)).toContain('readiness_2');

    unmount();
    expect(mock.spies.readiness.unsubscribe).toHaveBeenCalledOnce();
    act(() => {
      mock.emitReadinessEvent(third);
    });
    expect(result.current.snapshot?.generation).toBe(2);
  });
});
