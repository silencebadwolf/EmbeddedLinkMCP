import type { BrowserWindow as BrowserWindowType } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { electron } from '../platform/electron-runtime.js';

const { app, BrowserWindow, session } = electron;

// ESM 下手动派生 __dirname：Electron 主进程不支持 CJS `__dirname` 全局
const __dirname = dirname(fileURLToPath(import.meta.url));

/** 是否强制加载已构建的 renderer 文件，供本地一键启动脚本使用。 */
const FORCE_DIST = process.env.LINKTERM_FORCE_DIST === '1';

/** 是否处于开发模式：未打包且未强制加载 dist 时，由 vite dev server 提供渲染端。 */
const IS_DEV = !app.isPackaged && !FORCE_DIST;

/** 开发模式下 Vite dev server 的地址。HMR 需要 ws 连接到同一 host。 */
const DEV_SERVER_URL = 'http://localhost:5173';

/**
 * 安装 Content-Security-Policy 响应头。
 *
 * 为什么用 webRequest 而不是 <meta http-equiv>：
 * - meta 标签在 Vite dev 模式下会拦掉 HMR 的内联脚本与 ws 连接，调试体验差；
 * - webRequest 让我们按环境动态切换：dev 放开 'unsafe-inline'/'unsafe-eval' 与 ws，
 *   prod 收紧到只允许 self。
 *
 * 这同时消除 Electron 启动时的 "Insecure Content-Security-Policy" 警告。
 */
function installCspHeaders(): void {
  const csp = IS_DEV
    ? [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
        `connect-src 'self' ws://localhost:5173 ${DEV_SERVER_URL}`,
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

/**
 * 在 dev 模式下加载 Vite dev server，带重试机制。
 *
 * 为什么需要重试：Electron 启动可能早于 vite dev server，直接 loadURL 会触发
 * `did-fail-load` 并把渲染端切到 chrome-error:// 页面，之后再去拉 localhost
 * 会因 origin 不同被同源策略拦截 —— 这就是控制台 "Unsafe attempt to load URL" 的根因。
 *
 * 策略：监听 `did-fail-load`，500ms 后重试，最多 20 次（10s 上限）。
 */
function loadDevUrlWithRetry(win: BrowserWindowType): void {
  const MAX_ATTEMPTS = 20;
  const RETRY_DELAY_MS = 500;
  let attempts = 0;

  const attempt = (): void => {
    attempts += 1;
    win.loadURL(DEV_SERVER_URL).catch(() => {
      // loadURL reject 也算失败，由 did-fail-load 统一处理
    });
  };

  win.webContents.on('did-fail-load', (_event, errorCode: number, errorDescription: string, validatedURL: string) => {
    if (validatedURL && !validatedURL.startsWith(DEV_SERVER_URL)) return;
    if (attempts >= MAX_ATTEMPTS) {
      console.error(
        `[main] Vite dev server unreachable after ${MAX_ATTEMPTS} attempts: ${errorCode} ${errorDescription}`,
      );
      return;
    }
    setTimeout(attempt, RETRY_DELAY_MS);
  });

  attempt();
}

/**
 * 创建主窗口。
 *
 * 行为：
 * - 开发模式：加载 vite dev server（带重试），并打开 DevTools
 * - 生产模式：加载本地打包后的 `dist/renderer/index.html`
 *
 * 安全：启用 contextIsolation、关闭 nodeIntegration —— 渲染端只通过 IPC 与主进程交互。
 * CSP 通过 installCspHeaders() 按环境注入响应头。
 *
 * @returns 已创建并加载内容的 BrowserWindow 实例
 */
export function createMainWindow(): BrowserWindowType {
  installCspHeaders();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'LinkTerm v2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload 需要 sandbox=false（Electron 20+ 默认 sandbox 不支持 ES modules）。
      // 主防线仍是 contextIsolation + nodeIntegration=false：渲染上下文里 process / require 都拿不到。
      sandbox: false,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  if (IS_DEV) {
    loadDevUrlWithRetry(win);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * 窗口关闭前的清理钩子。Phase 5+ 会在此处释放 SessionManager / MCP server 等资源。
 *
 * @param _win 即将关闭的窗口实例（当前未使用，保留为后续扩展点）
 */
export function handleWindowClose(_win: BrowserWindowType): void {
  // Phase 5 起在这里 destroyAll session、shutdown MCP server
}
