// @vitest-environment happy-dom
/**
 * SerialPortPicker 单测：模式切换、空列表自动 manual 模式、自动刷新、可读串口名称。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SerialPortPicker } from '../../../../src/renderer/components/SerialPortPicker.js';
import { installMockPreload } from '../../../fixtures/mock-preload-api.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import type { SerialPortInfo } from '../../../../src/shared/types.js';

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

const settleSerialDiscovery = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('SerialPortPicker', () => {
  beforeEach(() => {
    resetStore();
    installMockPreload();
  });

  it('starts in manual mode when no ports', async () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} />);
    await settleSerialDiscovery();
    expect(screen.getByTestId('picker-manual-input')).toBeInTheDocument();
  });

  it('shows empty hint in auto mode when ports list is empty', async () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} />);
    await settleSerialDiscovery();
    fireEvent.click(screen.getByTestId('picker-mode-auto'));
    expect(screen.getByTestId('picker-empty')).toBeInTheDocument();
  });

  it('starts in auto mode when ports already discovered', async () => {
    const onChange = vi.fn();
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyUSB0' }];
    render(<SerialPortPicker value="" onChange={onChange} ports={ports} />);
    await settleSerialDiscovery();
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });

  it('calls onChange when manual input changes', async () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} />);
    await settleSerialDiscovery();
    fireEvent.change(screen.getByTestId('picker-manual-input'), {
      target: { value: '/dev/tty.usbserial' },
    });
    expect(onChange).toHaveBeenCalledWith('/dev/tty.usbserial');
  });

  it('auto refreshes on mount without rendering a refresh button', async () => {
    const mock = installMockPreload();
    render(<SerialPortPicker value="" onChange={() => undefined} />);
    await settleSerialDiscovery();
    expect(mock.spies.serial.listPorts).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('picker-refresh')).toBeNull();
  });

  it('uses friendlyName in the selectable port label before falling back to manufacturer', async () => {
    const ports: SerialPortInfo[] = [
      { path: 'COM8', manufacturer: 'wch.cn', friendlyName: 'USB-Enhanced-SERIAL CH343 (COM8)' },
      { path: 'COM9', manufacturer: 'FTDI' },
    ];
    render(<SerialPortPicker value="COM8" onChange={() => undefined} ports={ports} />);
    await settleSerialDiscovery();
    expect(screen.getByText('COM8 (USB-Enhanced-SERIAL CH343 (COM8))')).toBeInTheDocument();
  });

  it('switches between auto and manual via buttons', async () => {
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyS0' }];
    render(<SerialPortPicker value="" onChange={() => undefined} ports={ports} />);
    await settleSerialDiscovery();
    fireEvent.click(screen.getByTestId('picker-mode-manual'));
    expect(screen.getByTestId('picker-manual-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('picker-mode-auto'));
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });
});
