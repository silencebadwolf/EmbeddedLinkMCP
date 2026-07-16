// @vitest-environment happy-dom
/**
 * SessionTabBar 单测：渲染 tab 列表 + 关闭按钮 + 新建按钮。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionTabBar } from '../../../../src/renderer/components/SessionTabBar.js';
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

describe('SessionTabBar', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('shows empty hint when no sessions', () => {
    render(<SessionTabBar />);
    expect(screen.getByTestId('tabs-empty')).toBeInTheDocument();
  });

  it('renders one tab per session and the new button', () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'host-A',
      connectionType: 'ssh',
      state: 'open',
    });
    useAppStore.getState().addSession({
      id: 'sess_2',
      label: 'host-B',
      connectionType: 'serial',
      state: 'opening',
    });
    render(<SessionTabBar />);
    expect(screen.getByTestId('tab-sess_1')).toHaveTextContent('host-A');
    expect(screen.getByTestId('tab-sess_2')).toHaveTextContent('host-B');
    expect(screen.getByTestId('tabs-new')).toBeInTheDocument();
  });

  it('renders RTT log sessions with an RTT icon', () => {
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT channel 0',
      connectionType: 'rtt-log',
      state: 'open',
    });

    render(<SessionTabBar />);

    expect(screen.getByTestId('tab-sess_rtt')).toHaveTextContent('R');
    expect(screen.getByTestId('tab-sess_rtt')).toHaveTextContent('RTT channel 0');
  });

  it('clicking new button opens dialog in store', () => {
    render(<SessionTabBar />);
    fireEvent.click(screen.getByTestId('tabs-new'));
    expect(useAppStore.getState().dialogOpen).toBe(true);
  });

  it('clicking close button calls session.destroy', () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'host-A',
      connectionType: 'ssh',
      state: 'open',
    });
    render(<SessionTabBar />);
    fireEvent.click(screen.getByTestId('tab-close-sess_1'));
    expect(mock.spies.session.destroy).toHaveBeenCalledWith({ sessionId: 'sess_1' });
  });

  it('renders state badge with localized text', () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'X',
      connectionType: 'local-shell',
      state: 'errored',
    });
    render(<SessionTabBar />);
    // EN locale: 'errored'
    expect(screen.getByTestId('tab-sess_1')).toHaveTextContent('errored');
  });

  it('opens a session-filtered Activity Center from the origin entry', () => {
    const openActivity = vi.fn();
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'host-A',
      connectionType: 'serial',
      state: 'open',
    });

    render(<SessionTabBar onOpenActivityForSession={openActivity} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open activity for host-A; AI idle, Human idle, System idle',
      }),
    );

    expect(openActivity).toHaveBeenCalledWith('sess_1');
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
  });

  it('describes AI, human, and system activity in the origin entry label', () => {
    const now = Date.now();
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'host-A',
      connectionType: 'serial',
      state: 'open',
    });
    useAppStore.setState({
      originActivity: {
        sess_1: {
          ai: now,
          human: now - 10_000,
        },
      },
    });

    render(<SessionTabBar onOpenActivityForSession={() => undefined} />);

    expect(
      screen.getByRole('button', {
        name: 'Open activity for host-A; AI recent, Human idle, System idle',
      }),
    ).toBeInTheDocument();
  });

  it('does not render pause, resume, or take-over controls', () => {
    useAppStore.getState().addSession({
      id: 'sess_1',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });
    render(<SessionTabBar />);

    expect(screen.queryByText('AI paused')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pause|resume|take over/i })).not.toBeInTheDocument();
  });
});
