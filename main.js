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
const SHOW_LOADER_CHANNEL = 'steam:show-loader';
const HIDE_LOADER_CHANNEL = 'steam:hide-loader';
const STEAM_UI_CSS = fs.readFileSync(path.join(__dirname, 'steam-ui.css'), 'utf8');

// TODO: replace with the real Among Demons app id once Steamworks verification
// completes. 480 is Spacewar, Valve's public test app.
const STEAM_APP_ID = 480;
// Identity label echoed by the backend when validating tickets with
// ISteamUserAuth/AuthenticateUserTicket.
const AUTH_TICKET_IDENTITY = 'amongdemons';
// Only these API names may be unlocked from the page. Mirrors
// public/api/data/achievements.json in the website repo (steamName fields);
// ACH_WIN_ONE_GAME is kept for Spacewar (app 480) testing.
const ACHIEVEMENT_NAMES = new Set([
  'ACH_WIN_ONE_GAME',
  'ACH_MARKED_BY_THE_DARK',
  'ACH_BLOODED_HUNTER',
  'ACH_VETERAN_OF_ASH',
  'ACH_BEYOND_MORTAL',
  'ACH_ENDLESS_HUNGER',
  'ACH_FIRST_BLOOD',
  'ACH_PACTBOUND',
  'ACH_FRESH_BLOOD',
  'ACH_SIX_DEEP',
  'ACH_A_WAY_OUT',
  'ACH_TRIAL_OF_THE_FEW',
  'ACH_CALL_FROM_CAMP',
  'ACH_TERROR_BEGINS',
  'ACH_BELOW_THE_WORLD',
  'ACH_THERE_IS_NO_BOTTOM',
  'ACH_SOULFORGED',
  'ACH_RELENTLESS',
  'ACH_MYTH_MADE_FLESH',
  'ACH_EVERY_SHADE_OF_SIN',
  'ACH_ELEVENFOLD',
  'ACH_COMPLETE_BLOODLINE',
  'ACH_HALF_THE_MENAGERIE',
  'ACH_AMONG_DEMONS',
  'ACH_PERFECT_VESSEL',
  'ACH_ANCHORED',
  'ACH_ROAD_LESS_TRAVELLED',
  'ACH_DEATH_HAS_AN_ADDRESS',
  'ACH_HUNTERS_GROUND',
  'ACH_THE_LONG_HUNT',
  'ACH_VESSEL_BRIMMING',
  'ACH_THROUGH_DARKNESS',
  'ACH_FAR_FROM_THE_FIRE',
  'ACH_EDGEWALKER',
  'ACH_ASHES_REMEMBER',
  'ACH_HOLD_THE_LINE',
  'ACH_BLIND_THE_VOID',
  'ACH_ROT_THE_ROOT',
  'ACH_CURTAIN_CALL',
  'ACH_IRON_BREAKS',
  'ACH_HEARD_THE_WHISPER',
  'ACH_THE_LINE_HOLDS',
  'ACH_WAKE_THE_KING',
  'ACH_MOVE_THE_MOUNTAIN',
  'ACH_CUT_THE_THREAD',
  'ACH_STILL_THE_STORM',
  'ACH_CROWN_OF_RUIN',
  'ACH_HUNTER_HUNTED',
  'ACH_BLOOD_RIVALRY',
  'ACH_APEX_PREDATOR',
  'ACH_UNTOUCHABLE'
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

  // Show a loading overlay on the current page while the next document is
  // fetched. On success the overlay dies with the old document; it only needs
  // an explicit hide when the navigation never commits.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;

    mainWindow.webContents.send(SHOW_LOADER_CHANNEL);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame) return;

    mainWindow.webContents.send(HIDE_LOADER_CHANNEL);
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
    mainWindow.webContents.send(HIDE_LOADER_CHANNEL);
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
