// @vitest-environment happy-dom

import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWritableConnectionType } from '../../../../src/renderer/components/TerminalView.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const xtermMock = vi.hoisted(() => {
  type DataHandler = (data: string) => void;
  type KeyHandler = (event: KeyboardEvent) => boolean;
  const handlers: DataHandler[] = [];
  const keyHandlers: KeyHandler[] = [];
  const writes: string[] = [];
  const focuses: number[] = [];
  const pastes: string[] = [];
  class TerminalMock {
    readonly handlers = handlers;

    loadAddon(): void {
      /* noop */
    }

    open(): void {
      /* noop */
    }

    onData(handler: DataHandler): { dispose(): void } {
      handlers.push(handler);
      return {
        dispose: () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
        },
      };
    }

    write(data: string): void {
      writes.push(data);
    }

    paste(data: string): void {
      pastes.push(data);
      for (const handler of handlers) handler(data);
    }

    focus(): void {
      focuses.push(Date.now());
    }

    clear(): void {
      /* noop */
    }

    attachCustomKeyEventHandler(handler: KeyHandler): void {
      keyHandlers.push(handler);
    }

    dispose(): void {
      handlers.length = 0;
      keyHandlers.length = 0;
      writes.length = 0;
      focuses.length = 0;
      pastes.length = 0;
    }

    get cols(): number {
      return 80;
    }

    get rows(): number {
      return 24;
    }
  }

  return {
    handlers,
    keyHandlers,
    writes,
    focuses,
    pastes,
    TerminalMock,
  };
});

vi.mock('@xterm/xterm', () => ({ Terminal: xtermMock.TerminalMock }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {
      /* noop */
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

function resetStore(): void {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
    connectionDialogPrefill: null,
  });
  xtermMock.handlers.length = 0;
  xtermMock.keyHandlers.length = 0;
  xtermMock.writes.length = 0;
  xtermMock.focuses.length = 0;
  xtermMock.pastes.length = 0;
}

describe('TerminalView write gating', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('treats RTT log sessions as writable terminal sessions', () => {
    expect(isWritableConnectionType('serial')).toBe(true);
    expect(isWritableConnectionType('ssh')).toBe(true);
    expect(isWritableConnectionType('local-shell')).toBe(true);
    expect(isWritableConnectionType('rtt-log')).toBe(true);
  });

  it('calls session.write when users type in an RTT log terminal', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });

    render(React.createElement(TerminalView, { sessionId: 'sess_rtt' }));
    await waitFor(() => expect(xtermMock.handlers).toHaveLength(1));

    act(() => {
      xtermMock.handlers[0]?.('x');
    });

    await waitFor(() =>
      expect(mock.spies.session.write).toHaveBeenCalledWith({
        sessionId: 'sess_rtt',
        dataBase64: btoa('x'),
        priority: 'normal',
      }),
    );
  });

  it('normalizes RTT terminal Enter to CRLF before sending', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });

    render(React.createElement(TerminalView, { sessionId: 'sess_rtt' }));
    await waitFor(() => expect(xtermMock.handlers).toHaveLength(1));

    act(() => {
      xtermMock.handlers[0]?.('\r');
    });

    await waitFor(() =>
      expect(mock.spies.session.write).toHaveBeenCalledWith({
        sessionId: 'sess_rtt',
        dataBase64: btoa('\r\n'),
        priority: 'normal',
      }),
    );
  });

  it('focuses an RTT terminal after mount so manual typing is immediately accepted', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });

    render(React.createElement(TerminalView, { sessionId: 'sess_rtt' }));

    await waitFor(() => expect(xtermMock.focuses.length).toBeGreaterThan(0));
  });

  it('refocuses the terminal when users click the RTT terminal area', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });

    const { getByTestId } = render(React.createElement(TerminalView, { sessionId: 'sess_rtt' }));
    await waitFor(() => expect(xtermMock.focuses.length).toBeGreaterThan(0));
    const focusCount = xtermMock.focuses.length;

    fireEvent.mouseDown(getByTestId('terminal-view'));

    expect(xtermMock.focuses.length).toBeGreaterThan(focusCount);
  });

  it('refocuses the existing terminal when a take-over focus token changes', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_serial_focus',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    const { rerender } = render(
      React.createElement(TerminalView, { sessionId: 'sess_serial_focus', focusRequestToken: 0 }),
    );
    await waitFor(() => expect(xtermMock.focuses.length).toBeGreaterThan(0));
    const focusCount = xtermMock.focuses.length;

    rerender(
      React.createElement(TerminalView, { sessionId: 'sess_serial_focus', focusRequestToken: 1 }),
    );

    await waitFor(() => expect(xtermMock.focuses.length).toBeGreaterThan(focusCount));
    expect(mock.spies.session.write).not.toHaveBeenCalled();
    expect(mock.spies.session.destroy).not.toHaveBeenCalled();
  });

  it('pastes clipboard text into a writable terminal from the right-click menu', async () => {
    const readText = vi.fn(async () => 'version');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_serial_paste',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    const { getByTestId } = render(React.createElement(TerminalView, { sessionId: 'sess_serial_paste' }));
    await waitFor(() => expect(xtermMock.handlers).toHaveLength(1));

    fireEvent.contextMenu(getByTestId('terminal-view'));

    await waitFor(() => expect(xtermMock.pastes).toContain('version'));
    await waitFor(() =>
      expect(mock.spies.session.write).toHaveBeenCalledWith({
        sessionId: 'sess_serial_paste',
        dataBase64: btoa('version'),
        priority: 'normal',
      }),
    );
  });

  it('renders a visible terminal error when session.write returns a structured failure', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    mock.spies.session.write.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'NOT_WRITABLE',
        message: 'RTT down-channel 0 is not available',
      },
    });
    useAppStore.getState().addSession({
      id: 'sess_rtt',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });

    render(React.createElement(TerminalView, { sessionId: 'sess_rtt' }));
    await waitFor(() => expect(xtermMock.handlers).toHaveLength(1));

    act(() => {
      xtermMock.handlers[0]?.('x');
    });

    await waitFor(() =>
      expect(xtermMock.writes.join('')).toContain(
        '[write failed: NOT_WRITABLE] RTT down-channel 0 is not available',
      ),
    );
    expect(useAppStore.getState().originActivity.sess_rtt?.human).toBeUndefined();
  });

  it('calls session.write when users type in a writable terminal', async () => {
    const { TerminalView } = await import(
      '../../../../src/renderer/components/TerminalView.js'
    );
    useAppStore.getState().addSession({
      id: 'sess_serial',
      label: 'COM7',
      connectionType: 'serial',
      state: 'open',
    });

    render(React.createElement(TerminalView, { sessionId: 'sess_serial' }));
    await waitFor(() => expect(xtermMock.handlers).toHaveLength(1));

    act(() => {
      xtermMock.handlers[0]?.('x');
    });

    await waitFor(() =>
      expect(mock.spies.session.write).toHaveBeenCalledWith({
        sessionId: 'sess_serial',
        dataBase64: btoa('x'),
        priority: 'normal',
      }),
    );
  });
});
