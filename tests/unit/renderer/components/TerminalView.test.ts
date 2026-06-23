// @vitest-environment happy-dom

import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWritableConnectionType } from '../../../../src/renderer/components/TerminalView.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const xtermMock = vi.hoisted(() => {
  type DataHandler = (data: string) => void;
  const handlers: DataHandler[] = [];
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

    write(): void {
      /* noop */
    }

    clear(): void {
      /* noop */
    }

    attachCustomKeyEventHandler(): void {
      /* noop */
    }

    dispose(): void {
      handlers.length = 0;
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
}

describe('TerminalView write gating', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('treats RTT log sessions as read-only', () => {
    expect(isWritableConnectionType('serial')).toBe(true);
    expect(isWritableConnectionType('ssh')).toBe(true);
    expect(isWritableConnectionType('local-shell')).toBe(true);
    expect(isWritableConnectionType('rtt-log')).toBe(false);
  });

  it('does not call session.write when users type in an RTT log terminal', async () => {
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

    expect(mock.spies.session.write).not.toHaveBeenCalled();
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
