// @vitest-environment happy-dom

import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWritableConnectionType } from '../../../../src/renderer/components/TerminalView.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const xtermMock = vi.hoisted(() => {
  type DataHandler = (data: string) => void;
  const handlers: DataHandler[] = [];
  const writes: string[] = [];
  const focuses: number[] = [];
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

    focus(): void {
      focuses.push(Date.now());
    }

    clear(): void {
      /* noop */
    }

    attachCustomKeyEventHandler(): void {
      /* noop */
    }

    dispose(): void {
      handlers.length = 0;
      writes.length = 0;
      focuses.length = 0;
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
    writes,
    focuses,
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
  xtermMock.writes.length = 0;
  xtermMock.focuses.length = 0;
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
