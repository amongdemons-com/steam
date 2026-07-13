const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = 'https://amongdemons.com/camp';
const APP_HOST = new URL(APP_URL).hostname;
const SHOW_EXIT_DIALOG_CHANNEL = 'steam:show-exit-dialog';
const EXIT_GAME_CHANNEL = 'steam:exit-game';
const STEAM_UI_CSS = fs.readFileSync(path.join(__dirname, 'steam-ui.css'), 'utf8');

let mainWindow = null;

function isAmongDemonsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === APP_HOST || url.hostname.endsWith(`.${APP_HOST}`));
  } catch {
    return false;
  }
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed URLs from page content.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Among Demons',
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#171d2a',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.setFullScreen(true);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow.webContents.insertCSS(STEAM_UI_CSS);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape' || input.isAutoRepeat) return;

    event.preventDefault();
    mainWindow.webContents.send(SHOW_EXIT_DIALOG_CHANNEL);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAmongDemonsUrl(url)) {
      void mainWindow.loadURL(url);
    } else {
      openExternalUrl(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAmongDemonsUrl(url)) return;

    event.preventDefault();
    openExternalUrl(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(APP_URL);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

ipcMain.on(EXIT_GAME_CHANNEL, (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (!isAmongDemonsUrl(event.sender.getURL())) return;

  app.quit();
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.amongdemons.steam');
    Menu.setApplicationMenu(null);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
