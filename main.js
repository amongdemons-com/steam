const { app, BrowserWindow, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

const isDev = process.argv.includes('--dev') || !app.isPackaged;
const frontendDir = isDev
  ? path.resolve(__dirname, '..', 'app')
  : path.join(process.resourcesPath, 'app');
const vendorDir = isDev
  ? path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd')
  : path.join(process.resourcesPath, 'vendor', 'lucide');
const routeFiles = new Map([
  ['/', 'index.html'],
  ['/camp', 'camp.html'],
  ['/collection', 'collection.html'],
  ['/dungeon', 'dungeon.html'],
  ['/login', 'login.html'],
  ['/privacy', 'privacy.html'],
  ['/rankings', 'rankings.html'],
  ['/register', 'register.html'],
  ['/terms', 'terms.html']
]);

app.whenReady().then(() => {
  registerFileRoutes();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#090909',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(frontendDir, 'index.html'));
}

function registerFileRoutes() {
  protocol.interceptFileProtocol('file', (request, callback) => {
    callback(resolveFileRequest(request.url));
  });
}

function resolveFileRequest(requestUrl) {
  const directPath = toFilePath(requestUrl);
  if (directPath && fs.existsSync(directPath)) return directPath;

  const pathname = decodeURIComponent(new URL(requestUrl).pathname).replace(/\\/g, '/');
  const normalizedRoute = normalizeRoute(pathname);
  const routeFile = routeFiles.get(normalizedRoute);
  if (routeFile) return path.join(frontendDir, routeFile);

  const appPath = afterPathSegment(pathname, 'app');
  if (appPath) return path.join(frontendDir, appPath);

  const vendorPath = afterPathSegment(pathname, 'vendor');
  if (vendorPath) return resolveVendorPath(vendorPath);

  return directPath || path.join(frontendDir, 'index.html');
}

function toFilePath(requestUrl) {
  try {
    return fileURLToPath(requestUrl);
  } catch (error) {
    return '';
  }
}

function normalizeRoute(pathname) {
  const withoutDrive = pathname.replace(/^\/[A-Za-z]:/, '');
  const trimmed = withoutDrive.replace(/\/+$/, '') || '/';
  if (routeFiles.has(trimmed)) return trimmed;

  const firstSegment = `/${trimmed.split('/').filter(Boolean)[0] || ''}`;
  return routeFiles.has(firstSegment) ? firstSegment : trimmed;
}

function afterPathSegment(pathname, segment) {
  const normalized = pathname.replace(/\\/g, '/');
  const marker = `/${segment}/`;
  const index = normalized.toLowerCase().lastIndexOf(marker.toLowerCase());
  return index >= 0 ? normalized.slice(index + marker.length) : '';
}

function resolveVendorPath(vendorPath) {
  const normalized = vendorPath.replace(/\\/g, '/');
  const lucidePrefix = 'lucide/';
  if (normalized.toLowerCase().startsWith(lucidePrefix)) {
    return path.join(vendorDir, normalized.slice(lucidePrefix.length));
  }

  return path.join(vendorDir, normalized);
}
