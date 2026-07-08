// @vitest-environment happy-dom
/**
 * 终端复制快捷键单测。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  copyTerminalSelection,
  installTerminalClipboardShortcuts,
  installTerminalCopyShortcut,
  isTerminalCopyOnlyShortcut,
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  pasteTextToTerminal,
  type TerminalCopyKeyEvent,
} from '../../../../src/renderer/lib/terminal-clipboard.js';

const keyEvent = (patch: Partial<TerminalCopyKeyEvent>): TerminalCopyKeyEvent => ({
  altKey: false,
  ctrlKey: false,
  key: 'c',
  metaKey: false,
  shiftKey: false,
  type: 'keydown',
  ...patch,
});

describe('terminal clipboard helpers', () => {
  it('detects Ctrl/Cmd copy shortcuts only on keydown', () => {
    expect(isTerminalCopyShortcut(keyEvent({ ctrlKey: true }))).toBe(true);
    expect(isTerminalCopyShortcut(keyEvent({ metaKey: true, key: 'C' }))).toBe(true);
    expect(isTerminalCopyShortcut(keyEvent({ ctrlKey: true, type: 'keyup' }))).toBe(false);
    expect(isTerminalCopyShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isTerminalCopyShortcut(keyEvent({ ctrlKey: true, key: 'x' }))).toBe(false);
  });

  it('treats Ctrl+Shift+C as copy-only shortcut', () => {
    expect(isTerminalCopyOnlyShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isTerminalCopyOnlyShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
  });

  it('detects Ctrl/Cmd paste shortcuts only on keydown', () => {
    expect(isTerminalPasteShortcut(keyEvent({ ctrlKey: true, key: 'v' }))).toBe(true);
    expect(isTerminalPasteShortcut(keyEvent({ metaKey: true, key: 'V' }))).toBe(true);
    expect(isTerminalPasteShortcut(keyEvent({ ctrlKey: true, key: 'v', type: 'keyup' }))).toBe(
      false,
    );
    expect(isTerminalPasteShortcut(keyEvent({ ctrlKey: true, key: 'v', altKey: true }))).toBe(
      false,
    );
    expect(isTerminalPasteShortcut(keyEvent({ ctrlKey: true, key: 'c' }))).toBe(false);
  });

  it('copies terminal selection through injected writer', async () => {
    const writer = vi.fn(async () => true);
    const copied = await copyTerminalSelection({ getSelection: () => 'serial output' }, writer);
    expect(copied).toBe(true);
    expect(writer).toHaveBeenCalledWith('serial output');
  });

  it('does not copy empty selection', async () => {
    const writer = vi.fn(async () => true);
    const copied = await copyTerminalSelection({ getSelection: () => '' }, writer);
    expect(copied).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it('pastes non-empty clipboard text into the terminal', async () => {
    const reader = vi.fn(async () => 'boot\r');
    const terminal = { paste: vi.fn() };

    const pasted = await pasteTextToTerminal(terminal, reader);

    expect(pasted).toBe(true);
    expect(reader).toHaveBeenCalledOnce();
    expect(terminal.paste).toHaveBeenCalledWith('boot\r');
  });

  it('does not paste empty clipboard text', async () => {
    const reader = vi.fn(async () => '');
    const terminal = { paste: vi.fn() };

    const pasted = await pasteTextToTerminal(terminal, reader);

    expect(pasted).toBe(false);
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it('blocks Ctrl+C and writes clipboard when terminal has selection', () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined;
    const writer = vi.fn(() => true);

    installTerminalCopyShortcut(
      {
        attachCustomKeyEventHandler: (fn) => {
          handler = fn;
        },
        getSelection: () => 'device log',
      },
      writer,
    );

    expect(handler?.(keyEvent({ ctrlKey: true }) as KeyboardEvent)).toBe(false);
    expect(writer).toHaveBeenCalledWith('device log');
  });

  it('passes plain Ctrl+C through when there is no selection', () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined;
    const writer = vi.fn(() => true);

    installTerminalCopyShortcut(
      {
        attachCustomKeyEventHandler: (fn) => {
          handler = fn;
        },
        getSelection: () => '',
      },
      writer,
    );

    expect(handler?.(keyEvent({ ctrlKey: true }) as KeyboardEvent)).toBe(true);
    expect(writer).not.toHaveBeenCalled();
  });

  it('blocks Ctrl+Shift+C when there is no selection', () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined;
    const writer = vi.fn(() => true);

    installTerminalCopyShortcut(
      {
        attachCustomKeyEventHandler: (fn) => {
          handler = fn;
        },
        getSelection: () => '',
      },
      writer,
    );

    expect(handler?.(keyEvent({ ctrlKey: true, shiftKey: true }) as KeyboardEvent)).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it('blocks Ctrl+V and pastes clipboard text through the installed handler', async () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined;
    const reader = vi.fn(async () => 'help');
    const terminal = {
      attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
        handler = fn;
      },
      getSelection: () => '',
      paste: vi.fn(),
    };

    installTerminalClipboardShortcuts(terminal, vi.fn(() => true), reader);

    expect(handler?.(keyEvent({ ctrlKey: true, key: 'v' }) as KeyboardEvent)).toBe(false);
    await vi.waitFor(() => expect(terminal.paste).toHaveBeenCalledWith('help'));
  });
});
