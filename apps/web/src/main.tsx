import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, configureLinktermClient } from '@linkterm/ui';
import { createClientAPI } from '@linkterm/contracts/create-client';
import type { WebRuntimeInfo } from '@linkterm/contracts/web-protocol';
import { WebTransport, type ConnectionStatus } from './web-transport.js';
import { WorkspacePicker } from './workspace-picker.js';
import '@linkterm/ui/styles.css';
import './web.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

function WebApp(): React.ReactElement {
  const [transport, setTransport] = React.useState<WebTransport>();
  const [status, setStatus] = React.useState<ConnectionStatus>('connecting');
  const [generation, setGeneration] = React.useState(0);
  const [runtime, setRuntime] = React.useState<WebRuntimeInfo>();
  const [token, setToken] = React.useState('');
  const [loginError, setLoginError] = React.useState('');
  const [pickingWorkspace, setPickingWorkspace] = React.useState(false);
  const workspaceResolver = React.useRef<((root: string | null) => void) | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const session = await response.json() as { csrf: string; runtime: WebRuntimeInfo };
      if (!cancelled) activate(session);
    }).catch(() => { if (!cancelled) setLoginError('服务暂时无法连接，请检查服务端是否已启动。'); });
    return () => { cancelled = true; };
  }, []);
  function activate(session: { csrf: string; runtime: WebRuntimeInfo }): void {
    const next = new WebTransport(session.csrf, session.runtime);
    configureLinktermClient(() => createClientAPI(next));
    next.setWorkspacePicker(() => new Promise(resolve => { workspaceResolver.current = resolve; setPickingWorkspace(true); }));
    next.onStatus(nextStatus => { setStatus(nextStatus); setGeneration(next.generation); setRuntime(next.runtime); });
    setTransport(next); setRuntime(session.runtime); next.connect();
  }
  async function login(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setLoginError('');
    try {
      const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (!response.ok) { setLoginError(response.status === 401 ? '访问令牌不正确。' : '登录暂时失败，请稍后重试。'); return; }
      const session = await response.json() as { csrf: string; runtime: WebRuntimeInfo };
      setToken(''); activate(session);
    } catch { setLoginError('服务暂时无法连接，请检查服务端是否已启动。'); }
  }
  async function logout(): Promise<void> {
    workspaceResolver.current?.(null); workspaceResolver.current = null; setPickingWorkspace(false);
    await transport?.logout().catch(() => undefined);
    configureLinktermClient(() => null); setTransport(undefined); setStatus('connecting'); setGeneration(0);
  }
  if (!transport) return <main className="web-login"><form onSubmit={event => void login(event)}>
    <h1>LinkTerm Web</h1><p>连接此服务端的终端、串口和 J-Link 设备。</p>
    <label htmlFor="token">访问令牌</label><input id="token" type="password" autoComplete="off" required value={token} onChange={event => setToken(event.target.value)} />
    {loginError && <p role="alert" className="web-error">{loginError}</p>}
    <button type="submit">登录</button>
  </form></main>;
  return <div className="web-shell">
    <header className="web-hostbar"><strong>LinkTerm Web</strong><span>运行于 {runtime?.hostname ?? '服务端'} · {runtime?.platform ?? ''}，硬件与文件均在服务端</span>
      <button type="button" onClick={() => void transport.activateUiTarget()}>将此浏览器设为 UI 目标</button>
      <button type="button" onClick={() => void logout()}>退出</button></header>
    {status === 'connected' ? <App key={generation} /> : <div className="web-disconnected" role="status">连接已中断，正在重新连接。会话和任务保留在服务端；结果不确定的命令不会自动重发。</div>}
    {transport.uncertainRequests.length > 0 && <aside className="web-uncertain" role="alert">有 {transport.uncertainRequests.length} 个命令需要确认结果。重新连接后会查询其状态。</aside>}
    {pickingWorkspace && <WorkspacePicker transport={transport} onSelect={root => { workspaceResolver.current?.(root); workspaceResolver.current = null; setPickingWorkspace(false); }} onCancel={() => { workspaceResolver.current?.(null); workspaceResolver.current = null; setPickingWorkspace(false); }} />}
  </div>;
}
ReactDOM.createRoot(root).render(<React.StrictMode><WebApp /></React.StrictMode>);
