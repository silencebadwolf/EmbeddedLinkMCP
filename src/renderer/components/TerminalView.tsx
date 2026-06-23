/**
 * Xterm.js 终端视图。
 *
 * StrictMode 友好：cleanup 时真 dispose Terminal（不只是 clear），并以 ref-guard 防止 dispose 后残留写入。
 *
 * Resize：ResizeObserver 监听容器尺寸变化，非零守卫后再 fit；
 * fit 后调用 IPC `session:resize`（serial session 静默 noop）。
 */

import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ConnectionType, SessionId } from '../../shared/types.js';
import { useTranscript } from '../hooks/useTranscript.js';
import { useAppStore } from '../store/app-store.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { installTerminalCopyShortcut } from '../lib/terminal-clipboard.js';

/** TerminalView props。 */
export interface TerminalViewProps {
  sessionId: SessionId | null;
}

/** Ctrl-C 字节序列。`\x03` 是 SIGINT 的标准 ASCII。 */
const CTRL_C = '\x03';

/** 判断当前会话类型是否接受终端键盘写入。 */
export function isWritableConnectionType(connectionType: ConnectionType): boolean {
  return connectionType !== 'rtt-log';
}

/**
 * 把字符串编码到 base64（renderer 端不可用 Buffer）。
 * 使用 TextEncoder + btoa 显式拼装。
 */
function strToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * TerminalView 组件：渲染单个 session 的 xterm.js Terminal。
 */
export function TerminalView({ sessionId }: TerminalViewProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<{
    term: Terminal;
    fit: FitAddon;
    disposed: boolean;
    onDataDispose?: () => void;
    resizeObserver?: ResizeObserver;
  } | null>(null);
  const [terminal, setTerminal] = React.useState<Terminal | null>(null);
  const markOriginActivity = useAppStore((s) => s.markOriginActivity);
  const connectionType = useAppStore((s) => (sessionId ? s.sessions.get(sessionId)?.connectionType : undefined));

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    installTerminalCopyShortcut(term);

    const state: {
      term: Terminal;
      fit: FitAddon;
      disposed: boolean;
      onDataDispose?: () => void;
      resizeObserver?: ResizeObserver;
    } = { term, fit, disposed: false };
    termRef.current = state;
    setTerminal(term);

    // 等待容器拿到非零尺寸再 fit（StrictMode + 异步布局都可能触发 0×0 初始尺寸）
    const tryFit = (): void => {
      if (state.disposed) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // 极少数情况下 xterm 内部仍未就绪，下一次 RAF 再试
      }
    };
    requestAnimationFrame(tryFit);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (state.disposed) return;
        requestAnimationFrame(() => {
          tryFit();
          // 通知主进程 PTY/SSH 同步窗口；serial session 静默忽略
          if (sessionId && state.term.cols > 0 && state.term.rows > 0) {
            void getLinkterm()?.session.resize({
              sessionId,
              cols: state.term.cols,
              rows: state.term.rows,
            });
          }
        });
      });
      ro.observe(container);
      state.resizeObserver = ro;
    }

    return () => {
      state.disposed = true;
      if (state.resizeObserver) state.resizeObserver.disconnect();
      if (state.onDataDispose) state.onDataDispose();
      term.dispose();
      if (termRef.current === state) termRef.current = null;
      setTerminal(null);
    };
  }, [sessionId]);

  // 绑定 onData → IPC write；sessionId 切换时重新订阅
  React.useEffect(() => {
    const state = termRef.current;
    if (!state || !sessionId) return;
    if (state.onDataDispose) state.onDataDispose();

    const sub = state.term.onData((data: string) => {
      if (connectionType !== undefined && !isWritableConnectionType(connectionType)) return;
      const api = getLinkterm();
      if (!api) return;
      const isCtrlC = data === CTRL_C;
      const dataBase64 = strToBase64(data);
      void api.session
        .write({
          sessionId,
          dataBase64,
          priority: isCtrlC ? 'high' : 'normal',
        })
        .then(() => {
          markOriginActivity(sessionId, 'human');
        })
        .catch(() => {
          // 写入失败不在 xterm 显示——transcript 主进程侧若产生 error 事件会自然回放
        });
    });
    state.onDataDispose = () => sub.dispose();
    return () => {
      if (state.onDataDispose) state.onDataDispose();
      state.onDataDispose = undefined;
    };
  }, [sessionId, markOriginActivity, connectionType]);

  // transcript 订阅：把后端事件渲染进 xterm
  useTranscript(sessionId, terminal);

  return (
    <div
      ref={containerRef}
      data-testid="terminal-view"
      className="h-full w-full bg-black"
      style={{ minHeight: '300px' }}
    />
  );
}
