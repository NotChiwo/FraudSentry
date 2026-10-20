// ============================================================
// FraudSentry desktop app (Electron)
//
// Shows the offline single-file build (OCR engine built in) in its own
// window. It is locked down like the website promises:
//   • every http(s) request is blocked, so nothing can leave the computer;
//   • the page runs sandboxed, without Node.js, with context isolation;
//   • it cannot navigate away or open other windows (https links open in
//     the normal browser);
//   • only the camera may be requested (for the live receipt camera).
// Data (accounts, encrypted history) is kept in the app's own profile
// folder, like a browser's localStorage.
// ============================================================
const { app, BrowserWindow, protocol, net, session, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const APP_DIR = path.join(__dirname, 'app');
const START_URL = `${SCHEME}://fraudsentry/index.html`;

// a "standard, secure" scheme: a stable origin for localStorage and a secure context for Web Crypto
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

function serveApp(request) {
  const { pathname } = new URL(request.url);
  const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(APP_DIR + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function lockDown(ses) {
  // offline guarantee: no request to the network, ever
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  const cameraOnly = (permission, details) => permission === 'media' && (details?.mediaTypes ?? ['video']).every(t => t === 'video');
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(cameraOnly(permission, details)));
  ses.setPermissionCheckHandler((_wc, permission, _origin, details) => cameraOnly(permission, details) || permission === 'clipboard-sanitized-write');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    title: 'FraudSentry', backgroundColor: '#0b1020', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${SCHEME}://fraudsentry/`)) e.preventDefault(); });
  void win.loadURL(START_URL);
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveApp);
  lockDown(session.defaultSession);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
