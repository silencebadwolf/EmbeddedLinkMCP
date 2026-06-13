// @vitest-environment happy-dom
/**
 * SerialPortPicker 单测：模式切换、空列表自动 manual 模式、refresh 触发。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('SerialPortPicker', () => {
  beforeEach(() => {
    resetStore();
    installMockPreload();
  });

  it('starts in manual mode when no ports', () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} refresh={async () => undefined} />);
    expect(screen.getByTestId('picker-manual-input')).toBeInTheDocument();
  });

  it('shows empty hint in auto mode when ports list is empty', () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} refresh={async () => undefined} />);
    fireEvent.click(screen.getByTestId('picker-mode-auto'));
    expect(screen.getByTestId('picker-empty')).toBeInTheDocument();
  });

  it('starts in auto mode when ports already discovered', () => {
    const onChange = vi.fn();
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyUSB0' }];
    render(<SerialPortPicker value="" onChange={onChange} ports={ports} refresh={async () => undefined} />);
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });

  it('calls onChange when manual input changes', () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} refresh={async () => undefined} />);
    fireEvent.change(screen.getByTestId('picker-manual-input'), {
      target: { value: '/dev/tty.usbserial' },
    });
    expect(onChange).toHaveBeenCalledWith('/dev/tty.usbserial');
  });

  it('refresh button invokes refresh callback', () => {
    const refresh = vi.fn(async () => undefined);
    render(<SerialPortPicker value="" onChange={() => undefined} ports={[]} refresh={refresh} />);
    fireEvent.click(screen.getByTestId('picker-refresh'));
    expect(refresh).toHaveBeenCalled();
  });

  it('switches between auto and manual via buttons', () => {
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyS0' }];
    render(<SerialPortPicker value="" onChange={() => undefined} ports={ports} refresh={async () => undefined} />);
    fireEvent.click(screen.getByTestId('picker-mode-manual'));
    expect(screen.getByTestId('picker-manual-input')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('picker-mode-auto'));
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });
});
