const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const steamworks = require('steamworks.js');

const APP_URL = 'https://amongdemons.com/camp';
const APP_HOST = new URL(APP_URL).hostname;
const SHOW_EXIT_DIALOG_CHANNEL = 'steam:show-exit-dialog';
const EXIT_GAME_CHANNEL = 'steam:exit-game';
const GET_AUTH_TICKET_CHANNEL = 'steam:get-auth-ticket';
const UNLOCK_ACHIEVEMENT_CHANNEL = 'steam:unlock-achievement';
const STEAM_UI_CSS = fs.readFileSync(path.join(__dirname, 'steam-ui.css'), 'utf8');

// TODO: replace with the real Among Demons app id once Steamworks verification
// completes. 480 is Spacewar, Valve's public test app.
const STEAM_APP_ID = 480;
// Identity label echoed by the backend when validating tickets with
// ISteamUserAuth/AuthenticateUserTicket.
const AUTH_TICKET_IDENTITY = 'amongdemons';
// Only these API names may be unlocked from the page. ACH_WIN_ONE_GAME is a
// Spacewar test achievement; replace with the real list from Steamworks.
const ACHIEVEMENT_NAMES = new Set([
  'ACH_WIN_ONE_GAME'
]);

let mainWindow = null;
let steamClient = null;
let activeAuthTicket = null;

try {
  steamClient = steamworks.init(STEAM_APP_ID);
} catch (error) {
  // Launched outside Steam (or Steam not running): keep the game playable,
  // the page just won't see a steamBridge session.
  console.warn('Steamworks unavailable:', error.message);
}

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

function isTrustedGameSender(event) {
  return mainWindow !== null
    && event.sender === mainWindow.webContents
    && isAmongDemonsUrl(event.sender.getURL());
}

ipcMain.on(EXIT_GAME_CHANNEL, (event) => {
  if (!isTrustedGameSender(event)) return;

  app.quit();
});

ipcMain.handle(GET_AUTH_TICKET_CHANNEL, async (event) => {
  if (!isTrustedGameSender(event) || !steamClient) return null;

  try {
    // Cancelling the previous ticket invalidates it Steam-side; the backend
    // only needs each ticket once, for the login handshake.
    activeAuthTicket?.cancel();
    activeAuthTicket = await steamClient.auth.getAuthTicketForWebApi(AUTH_TICKET_IDENTITY);
    return Buffer.from(activeAuthTicket.getBytes()).toString('hex');
  } catch (error) {
    console.warn('Failed to get Steam auth ticket:', error.message);
    return null;
  }
});

ipcMain.handle(UNLOCK_ACHIEVEMENT_CHANNEL, (event, name) => {
  if (!isTrustedGameSender(event) || !steamClient) return false;
  if (typeof name !== 'string' || !ACHIEVEMENT_NAMES.has(name)) return false;

  return steamClient.achievement.activate(name);
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
