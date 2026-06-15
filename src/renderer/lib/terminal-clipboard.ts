import type { Terminal } from '@xterm/xterm';

/** 可注入的文本复制函数，便于组件与单元测试共用同一快捷键逻辑。 */
export type ClipboardWriter = (text: string) => Promise<boolean> | boolean;

/** 终端复制快捷键需要读取的键盘事件字段。 */
export type TerminalCopyKeyEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey' | 'type'
>;

/** 终端复制逻辑需要的最小 xterm 接口。 */
export type CopyableTerminal = Pick<Terminal, 'attachCustomKeyEventHandler' | 'getSelection'>;

/**
 * 判断键盘事件是否是终端复制快捷键。
 *
 * 支持常见桌面习惯：`Ctrl+C` / `Cmd+C` 在有选区时复制，`Ctrl+Shift+C` / `Cmd+Shift+C` 始终作为复制快捷键处理。
 *
 * @param event 键盘事件。
 * @returns 是复制快捷键时返回 true。
 */
export function isTerminalCopyShortcut(event: TerminalCopyKeyEvent): boolean {
  if (event.type !== 'keydown') return false;
  if (event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === 'c';
}

/**
 * 判断键盘事件是否是只用于复制的终端快捷键。
 *
 * `Ctrl+Shift+C` / `Cmd+Shift+C` 不应透传为终端 `Ctrl-C`，即使当前没有选区。
 *
 * @param event 键盘事件。
 * @returns 是 copy-only 快捷键时返回 true。
 */
export function isTerminalCopyOnlyShortcut(event: TerminalCopyKeyEvent): boolean {
  return isTerminalCopyShortcut(event) && event.shiftKey;
}

/**
 * 把文本写入系统剪贴板。
 *
 * 优先使用现代 Clipboard API；当 Electron/浏览器环境拒绝时，回退到隐藏 textarea + `execCommand('copy')`。
 *
 * @param text 要复制的文本。
 * @returns 复制成功返回 true；无文本或环境不支持时返回 false。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false;

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Electron file:// 或权限策略可能拒绝 Clipboard API，继续走 DOM fallback。
    }
  }

  return copyTextWithTextareaFallback(text);
}

/**
 * 使用隐藏 textarea 执行浏览器复制命令。
 *
 * @param text 要复制的文本。
 * @returns 复制命令成功返回 true，否则返回 false。
 */
function copyTextWithTextareaFallback(text: string): boolean {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  const activeElement = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return doc.execCommand('copy');
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
}

/**
 * 复制 xterm 当前选区。
 *
 * @param term xterm 终端实例或测试替身。
 * @param writeClipboard 剪贴板写入函数，默认写入系统剪贴板。
 * @returns 有选区且复制成功时返回 true。
 */
export async function copyTerminalSelection(
  term: Pick<Terminal, 'getSelection'>,
  writeClipboard: ClipboardWriter = copyTextToClipboard,
): Promise<boolean> {
  const selection = term.getSelection();
  if (selection.length === 0) return false;
  return Boolean(await writeClipboard(selection));
}

/**
 * 给 xterm 安装复制快捷键处理器。
 *
 * 有选区时，`Ctrl+C` / `Cmd+C` 和 `Ctrl+Shift+C` / `Cmd+Shift+C` 都复制选区并阻止字节进入终端；
 * 无选区时，普通 `Ctrl+C` 继续透传给终端用于中断，copy-only 快捷键则被消费掉。
 *
 * @param term xterm 终端实例或测试替身。
 * @param writeClipboard 剪贴板写入函数，默认写入系统剪贴板。
 */
export function installTerminalCopyShortcut(
  term: CopyableTerminal,
  writeClipboard: ClipboardWriter = copyTextToClipboard,
): void {
  term.attachCustomKeyEventHandler((event) => {
    if (!isTerminalCopyShortcut(event)) return true;

    const selection = term.getSelection();
    if (selection.length > 0) {
      void Promise.resolve(writeClipboard(selection)).catch(() => undefined);
      return false;
    }

    return !isTerminalCopyOnlyShortcut(event);
  });
}
