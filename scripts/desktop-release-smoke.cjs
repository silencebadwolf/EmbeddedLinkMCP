const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const packageRoot = process.env.LINKTERM_PACKAGED_ROOT;
if (!packageRoot) throw new Error('LINKTERM_PACKAGED_ROOT is required');
const archive = join(packageRoot, 'resources', 'app.asar');
const profile = process.env.LINKTERM_SMOKE_PROFILE;
if (!profile) throw new Error('LINKTERM_SMOKE_PROFILE is required');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setPath('appData', profile);
app.setPath('home', profile);
app.commandLine.appendSwitch('disable-gpu');
writeFileSync(join(profile, 'mcp-http-settings.json'), JSON.stringify({
  schemaVersion: 'linkterm-mcp-http-settings/1.0.0', host: '127.0.0.1', port: 0,
  token: 'packaged-smoke-only-token-abcdefghijklmnopqrstuvwxyz',
}));
const deadline = setTimeout(() => { process.stderr.write('Packaged smoke timeout\n'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  let context;
  let window;
  try {
    const module = await import(pathToFileURL(join(archive, 'dist/main/ipc/index.js')).href);
    context = await module.registerIpcHandlers({ autoStartMcp: false, getMainWindow: () => window ?? null });
    window = new BrowserWindow({ show: false, webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      preload: join(archive, 'dist/preload/index.js'),
    } });
    window.webContents.on('preload-error', (_event, _path, error) => process.stderr.write(`Preload error: ${error.message}\n`));
    await window.loadFile(join(archive, 'dist/renderer/index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => ({
      api: Boolean(window.linkterm?.session),
      sessions: window.linkterm ? await window.linkterm.session.list() : null,
      rendered: document.getElementById('root')?.childElementCount > 0,
    }))()`);
    if (!result.api || !result.sessions?.success || !result.rendered) throw new Error(JSON.stringify(result));
    const created = await window.webContents.executeJavaScript(`window.linkterm.session.create({config:{type:'local-shell'}})`);
    if (!created.success) throw new Error(`Shell create failed: ${JSON.stringify(created)}`);
    const id = created.data.sessionId;
    const written = await window.webContents.executeJavaScript(`window.linkterm.session.write({sessionId:${JSON.stringify(id)},dataBase64:btoa('echo PACKAGED_SMOKE_OK\\r')})`);
    if (!written.success) throw new Error(`Shell write failed: ${JSON.stringify(written)}`);
    let output = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      const read = await window.webContents.executeJavaScript(`window.linkterm.session.read({sessionId:${JSON.stringify(id)},cursor:0})`);
      if (read.success) output = read.data.events.map(event => event.dataBase64 ? Buffer.from(event.dataBase64, 'base64').toString('utf8') : '').join('');
      if (output.includes('PACKAGED_SMOKE_OK')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!output.includes('PACKAGED_SMOKE_OK')) throw new Error(`No native PTY output: ${output}`);
    await window.webContents.executeJavaScript(`window.linkterm.session.destroy({sessionId:${JSON.stringify(id)}})`);
    process.stdout.write(JSON.stringify({ packagedDesktopSmoke: 'passed', ...result, nativePty: true }) + '\n');
    window.destroy();
    await context.dispose();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    process.stderr.write((error.stack ?? String(error)) + '\n');
    window?.destroy();
    await context?.dispose();
    clearTimeout(deadline);
    app.exit(1);
  }
});
