// @vitest-environment happy-dom

import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '@/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

vi.mock('../../../../src/renderer/components/TerminalView.js', () => ({
  TerminalView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-testid={`terminal-${sessionId ?? 'none'}`}>{sessionId}</div>
  ),
}));

vi.mock('../../../../src/renderer/components/ConnectionDialog.js', () => ({
  ConnectionDialog: () => <div data-testid="connection-dialog" />,
}));

function resetStore(): void {
  sessionStorage.clear();
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
    connectionDialogPrefill: null,
  });
}

function expectNoHardwareOrMutationSideEffects(mock: MockPreloadAPI): void {
  expect(mock.spies.session.create, 'session.create').not.toHaveBeenCalled();
  expect(mock.spies.session.write, 'session.write').not.toHaveBeenCalled();
  expect(mock.spies.connections.saveAndOpen, 'connections.saveAndOpen').not.toHaveBeenCalled();
  expect(mock.spies.connections.open, 'connections.open').not.toHaveBeenCalled();
  expect(mock.spies.connections.delete, 'connections.delete').not.toHaveBeenCalled();
  expect(mock.spies.rttLog.open, 'rttLog.open').not.toHaveBeenCalled();
  expect(mock.spies.agentIntegrations.install, 'agentIntegrations.install').not.toHaveBeenCalled();
  expect(mock.spies.agentIntegrations.uninstall, 'agentIntegrations.uninstall').not.toHaveBeenCalled();
  expect(mock.spies.jlinkDevices.search, 'jlinkDevices.search').not.toHaveBeenCalled();
  expect(mock.spies.jlinkDevices.get, 'jlinkDevices.get').not.toHaveBeenCalled();
  expect(mock.spies.jlinkDevices.refresh, 'jlinkDevices.refresh').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.save, 'controlProfile.save').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.openRecord, 'controlProfile.openRecord').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.deleteRecord, 'controlProfile.deleteRecord').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.runDownload, 'controlProfile.runDownload').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.startDownload, 'controlProfile.startDownload').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.connectChip, 'controlProfile.connectChip').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.disconnectChip, 'controlProfile.disconnectChip').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.pickWorkspaceRoot, 'controlProfile.pickWorkspaceRoot').not.toHaveBeenCalled();
  expect(mock.spies.controlProfile.pickFirmwareFile, 'controlProfile.pickFirmwareFile').not.toHaveBeenCalled();
}

describe('StartCenter no hardware side effects', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
    mock.setReadinessSnapshot(mock.readinessSnapshot(1, 'action-required'));
  });

  it('renders readiness without creating/opening sessions or touching hardware/mutation APIs', async () => {
    const { App } = await import('@/renderer/App.js');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Start Center' })).toBeInTheDocument();
    expect(mock.spies.readiness.subscribe).not.toHaveBeenCalled();
    expectNoHardwareOrMutationSideEffects(mock);
  });

  it('does not expose readiness refresh or hydrate advanced devices from the workspace home', async () => {
    const { App } = await import('@/renderer/App.js');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Start Center' })).toBeInTheDocument();
    expect(screen.queryByText('Advanced devices')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh readiness' })).toBeNull();
    expect(mock.spies.readiness.refresh).not.toHaveBeenCalled();
    expect(mock.spies.readiness.subscribe).not.toHaveBeenCalled();
    expectNoHardwareOrMutationSideEffects(mock);
  });
});
