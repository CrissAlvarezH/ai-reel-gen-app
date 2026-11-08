// Reel Studio as a desktop app: a native window over the same local server the browser uses.
// The app starts the server itself (with Electron's own Node, so no system node is needed) unless one
// is already running on the port, in which case it just opens it. While the app is open, the browser
// keeps working too (http://localhost:4000, or the LAN IP from another Mac).
// Run from the repo with `npm run desktop`, or installed (`npm run dist` builds the macOS app, unsigned):
// then the files a new workspace starts with come inside the app (Resources/workspace, see server/workspace.ts).
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {app, BrowserWindow, dialog, ipcMain, nativeTheme, shell} from 'electron';

const STUDIO = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT ?? 4000);
const URL = `http://localhost:${PORT}`;
// The UI's background for the system theme (src/index.css: oklch(0.16 0.025 290) dark, white light), so the window doesn't flash.
const bg = () => (nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff');
const fg = () => (nativeTheme.shouldUseDarkColors ? '#a1a1a1' : '#737373');

let server: ChildProcess | null = null; // only set when this app started it
let log = '';
let win: BrowserWindow | null = null;

const up = async () => {
  try {
    return (await fetch(`${URL}/api/workspace`)).ok; // open even before a workspace is chosen
  } catch {
    return false;
  }
};

async function ensureServer(): Promise<void> {
  if (await up()) return; // already running (npm start in a terminal): use it
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    cwd: STUDIO,
    // The app's settings folder holds which workspace to use (server/workspace.ts).
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      REEL_STUDIO_CONFIG_DIR: app.getPath('userData'),
      // Installed, it only listens on this machine until network access has a password (HOST=0.0.0.0 opens it).
      ...(app.isPackaged ? {REEL_STUDIO_RESOURCES: path.join(process.resourcesPath, 'workspace'), HOST: process.env.HOST ?? '127.0.0.1'} : {}),
    },
  });
  const keep = (d: Buffer) => {
    process.stdout.write(d);
    log = (log + d).slice(-4000);
  };
  server.stdout?.on('data', keep);
  server.stderr?.on('data', keep);
  const exited = new Promise<never>((_, reject) => server!.once('exit', (code) => reject(new Error(`el servidor salió con código ${code}`))));
  const ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (await up()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('el servidor no respondió en 30 s');
  })();
  await Promise.race([ready, exited]);
}

const page = (body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg()};color:${fg()};font:14px -apple-system,system-ui,'Segoe UI',sans-serif;-webkit-app-region:drag">${body}</body></html>`,
  )}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]!);

async function open() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'Reel Studio',
    backgroundColor: bg(),
    webPreferences: {preload: path.join(import.meta.dirname, 'preload.cjs')},
    // Native Mac look: no title bar, traffic lights inside the app's header (src/index.css .desktop).
    // Windows and Linux keep the system's frame and buttons.
    ...(process.platform === 'darwin' ? {titleBarStyle: 'hiddenInset' as const, trafficLightPosition: {x: 18, y: 20}} : {autoHideMenuBar: true}),
  });
  win.on('closed', () => (win = null));

  // Links to other sites (credits, Instagram…) open in the default browser, not inside the app.
  win.webContents.setWindowOpenHandler(({url}) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return {action: 'deny'};
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL) && !url.startsWith('data:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  await win.loadURL(page('Arrancando Reel Studio…'));
  try {
    await ensureServer();
    await win?.loadURL(URL);
  } catch (e) {
    await win?.loadURL(
      page(`<div style="max-width:640px"><p style="color:#fafafa">No pude arrancar el servidor: ${esc((e as Error).message)}</p><pre style="white-space:pre-wrap;font-size:11px">${esc(log.slice(-2000))}</pre></div>`),
    );
  }
}

app.setName('Reel Studio');
// Same settings folder the server uses when started on its own (server/workspace.ts), unless one is given
// with --user-data-dir (e.g. to try the first run without touching the real settings).
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Reel Studio'));

// One app at a time: opening it again focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  // The welcome page's "Elegir…": a native folder picker (desktop/preload.cjs).
  ipcMain.handle('pick-folder', async (_e, defaultPath?: string) => {
    const opts = {properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[], defaultPath, buttonLabel: 'Usar esta carpeta'};
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  });
  app.whenReady().then(open);
  // Mac: closing the window keeps the app (and the server) in the Dock; clicking it reopens the window.
  app.on('activate', () => {
    if (!win) open();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // Stop the server only if this app started it.
  app.on('will-quit', () => {
    server?.kill('SIGTERM');
  });
}
