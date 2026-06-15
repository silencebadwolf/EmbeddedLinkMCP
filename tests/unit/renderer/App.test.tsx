// @vitest-environment happy-dom
/**
 * App 根组件单测。
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../../src/renderer/store/app-store.js';
import { installMockPreload } from '../../fixtures/mock-preload-api.js';

vi.mock('../../../src/renderer/components/TerminalView.js', () => ({
  TerminalView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-testid={`terminal-${sessionId ?? 'none'}`}>{sessionId}</div>
  ),
}));

vi.mock('../../../src/renderer/components/ConnectionDialog.js', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

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

describe('App', () => {
  beforeEach(() => {
    resetStore();
    installMockPreload();
  });

  it('keeps one terminal instance mounted per session so switching tabs preserves output', async () => {
    const { addSession, setActive } = useAppStore.getState();
    addSession({ id: 'sess_1', label: 'COM1', connectionType: 'serial', state: 'open' });
    addSession({ id: 'sess_2', label: 'COM2', connectionType: 'serial', state: 'open' });
    setActive('sess_1');

    const { App } = await import('../../../src/renderer/App.js');
    render(<App />);

    expect(screen.getByTestId('terminal-sess_1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-sess_2')).toBeInTheDocument();
  });
});
