import React from 'react';
import { createPortal } from 'react-dom';
import type { DirectoryListing, WebTransport } from './web-transport.js';

/** Browse only directories offered by the host, with explicit create/select actions. */
export function WorkspacePicker({ transport, onSelect, onCancel }: { transport: WebTransport; onSelect: (root: string) => void; onCancel: () => void }): React.ReactElement {
  const [trail, setTrail] = React.useState<string[]>([]);
  const [listing, setListing] = React.useState<DirectoryListing>();
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const currentId = trail.at(-1);
  React.useEffect(() => {
    let current = true;
    void transport.listWorkspaces(currentId).then(result => { if (current) { setListing(result); setError(''); } }, () => { if (current) setError('无法列出服务端工作区。'); });
    return () => { current = false; };
  }, [transport, currentId]);
  const select = async (): Promise<void> => {
    if (!currentId) return;
    setBusy(true);
    try { onSelect(await transport.selectWorkspace(currentId)); }
    catch { setError('该工作区已失效或不在允许的目录内。'); }
    finally { setBusy(false); }
  };
  const create = async (): Promise<void> => {
    if (!currentId || !name.trim()) return;
    setBusy(true);
    try { const created = await transport.createWorkspace(currentId, name.trim()); setName(''); setTrail([...trail, created.id]); }
    catch { setError('无法创建目录；请检查名称或服务端文件权限。'); }
    finally { setBusy(false); }
  };
  const host = document.querySelector('[role="dialog"][data-state="open"]') ?? document.body;
  return createPortal(<div className="web-picker-backdrop" role="presentation"><section className="web-picker" role="dialog" aria-modal="true" aria-label="选择服务端工作区" onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
    <h2>选择服务端工作区</h2><p>下方目录位于服务端。浏览器电脑上的目录不会被访问。</p>
    <div className="web-picker-toolbar"><button type="button" disabled={!trail.length || busy} onClick={() => setTrail(trail.slice(0, -1))}>返回上一级</button><span>{listing?.current?.path ?? '可用工作区根目录'}</span></div>
    <ul className="web-picker-list">{listing?.directories.map(directory => <li key={directory.id}><button type="button" onClick={() => setTrail([...trail, directory.id])}>{directory.name}</button></li>)}</ul>
    {listing?.current && <div className="web-picker-create"><input aria-label="新目录名称" value={name} onChange={event => setName(event.target.value)} placeholder="新目录名称" /><button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>新建子目录</button></div>}
    {error && <p role="alert" className="web-error">{error}</p>}
    <div className="web-picker-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" disabled={!currentId || busy} onClick={() => void select()}>选择此目录</button></div>
  </section></div>, host);
}
