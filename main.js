const { app, BrowserWindow, Menu, ipcMain, session, shell, screen } = require('electron');
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
const RELOAD_GAME_CHANNEL = 'steam:reload-game';
const STEAM_UI_CSS = fs.readFileSync(path.join(__dirname, 'steam-ui.css'), 'utf8');

const STEAM_APP_ID = 4973450;
// Identity label echoed by the backend when validating tickets with
// ISteamUserAuth/AuthenticateUserTicket.
const AUTH_TICKET_IDENTITY = 'amongdemons';
// Only these API names may be unlocked from the page. Mirrors
// public/api/data/achievements.json in the website repo (steamName fields).
const ACHIEVEMENT_NAMES = new Set([
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
let loadRetryTimer = null;
let loadRetryCount = 0;
let lastDocumentHttpError = false;

const LOG_MAX_BYTES = 1024 * 1024;
const LOAD_RETRY_BASE_MS = 2000;
const LOAD_RETRY_MAX_MS = 15000;

function logFilePath() {
  return path.join(app.getPath('userData'), 'wrapper.log');
}

// Best-effort diagnostics for load failures reported by players; logging must
// never break the game.
function logToFile(message) {
  try {
    fs.appendFileSync(logFilePath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function rotateLogIfLarge() {
  try {
    const file = logFilePath();
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
      fs.rmSync(`${file}.old`, { force: true });
      fs.renameSync(file, `${file}.old`);
    }
  } catch {}
}

// Chromium net error codes -400..-499 are disk cache failures (ERR_CACHE_MISS,
// ERR_CACHE_READ_FAILURE, ...); the cache itself is suspect then.
function isCacheError(errorCode) {
  return errorCode <= -400 && errorCode > -500;
}

// Retry a broken navigation with backoff so a launch before the network is
// up, a server blip, or a CDN rate-limit window recovers on its own instead
// of stranding the player.
function scheduleLoadRetry(url, clearCacheFirst = false, minDelayMs = 0) {
  const delay = Math.max(
    Math.min(LOAD_RETRY_BASE_MS * 2 ** loadRetryCount, LOAD_RETRY_MAX_MS),
    minDelayMs
  );
  loadRetryCount += 1;
  clearTimeout(loadRetryTimer);
  loadRetryTimer = setTimeout(async () => {
    if (!mainWindow) return;

    if (clearCacheFirst) {
      try {
        await mainWindow.webContents.session.clearCache();
        logToFile('cleared disk cache before retry');
      } catch {}
    }

    void mainWindow.loadURL(isAmongDemonsUrl(url) ? url : APP_URL);
  }, delay);
}

const STALL_THRESHOLD_MS = 10000;
const REPEAT_FAILURE_WINDOW_MS = 60000;
const REPEAT_FAILURE_THRESHOLD = 3;
const CACHE_HEAL_COOLDOWN_MS = 5 * 60000;
let lastCacheHealAt = 0;
const recentRequestFailures = new Map();

// The same URL failing over and over while the server is healthy is the
// signature of a corrupted disk-cache entry (immutable assets are served
// straight from cache, so the failure repeats until the entry is evicted).
// Self-heal: drop the cache once and reload.
function noteRequestFailure(ses, url) {
  const now = Date.now();
  const times = (recentRequestFailures.get(url) || [])
    .filter((time) => now - time < REPEAT_FAILURE_WINDOW_MS);
  times.push(now);
  recentRequestFailures.set(url, times);

  if (times.length < REPEAT_FAILURE_THRESHOLD) return;
  recentRequestFailures.clear();

  if (now - lastCacheHealAt < CACHE_HEAL_COOLDOWN_MS) return;
  lastCacheHealAt = now;

  logToFile(`repeated failures for ${url}; clearing cache and reloading`);
  void (async () => {
    try {
      await ses.clearCache();
    } catch {}
    if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
  })();
}

// A request that hangs without erroring never shows up in did-fail-load or
// the console — e.g. render-blocking CSS on a dead socket blanks the page
// with zero errors anywhere. Flag anything still pending after 10s.
function installStallLogger(ses) {
  const pending = new Map();

  ses.webRequest.onSendHeaders((details) => {
    pending.set(details.id, { url: details.url, startedAt: Date.now(), logged: false });
  });
  ses.webRequest.onCompleted((details) => {
    pending.delete(details.id);
  });
  ses.webRequest.onErrorOccurred((details) => {
    // Aborted requests are routine while navigating; anything else is a real
    // network failure worth recording.
    if (details.error !== 'net::ERR_ABORTED') {
      logToFile(`request error ${details.error} ${details.url}`);
      noteRequestFailure(ses, details.url);
    }
    pending.delete(details.id);
  });

  setInterval(() => {
    const now = Date.now();
    for (const entry of pending.values()) {
      if (!entry.logged && now - entry.startedAt > STALL_THRESHOLD_MS) {
        entry.logged = true;
        logToFile(`request stalled >${STALL_THRESHOLD_MS / 1000}s: ${entry.url}`);
      }
    }
  }, 5000);
}

try {
  steamClient = steamworks.init(STEAM_APP_ID);
} catch (error) {
  // Launched outside Steam (or Steam not running): keep the game playable,
  // the page just won't see a steamBridge session.
  console.warn('Steamworks unavailable:', error.message);
}

// Electron normally renders in a separate GPU process and may stop repainting
// when the page is visually idle. Steam's overlay cannot hook that rendering
// path reliably, so keep Chromium's GPU work in this process and invalidate the
// window each frame. This must run before the first BrowserWindow is created.
steamworks.electronEnableSteamOverlay();

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
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  mainWindow = new BrowserWindow({
    title: 'Among Demons',
    show: false,
    // Native fullscreen leaves duplicate/ghost entries in the Windows 11
    // Alt+Tab switcher on affected builds. A frameless full-display window keeps
    // the game borderless while staying on the normal windowed compositor path.
    fullscreen: false,
    fullscreenable: false,
    frame: false,
    thickFrame: false,
    resizable: false,
    ...display.bounds,
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
    // A normal window stays below the Windows taskbar. Raise the game just
    // above it while focused, then immediately yield when the player tabs out.
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.show();
  });

  mainWindow.on('focus', () => {
    const activeDisplay = screen.getDisplayMatching(mainWindow.getBounds());
    mainWindow.setBounds(activeDisplay.bounds);
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  });

  mainWindow.on('blur', () => {
    mainWindow.setAlwaysOnTop(false);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow.webContents.insertCSS(STEAM_UI_CSS);
    // The show-loader message races fast navigations: it can land on the NEW
    // document (which then keeps the overlay forever), so always hide once a
    // load completes.
    // An HTTP-error document (e.g. a CDN 429) also "finishes" loading; its
    // scheduled retry must survive this event, and the loader should keep
    // covering the empty error body while the retry waits.
    if (!lastDocumentHttpError) {
      mainWindow.webContents.send(HIDE_LOADER_CHANNEL);
      clearTimeout(loadRetryTimer);
      loadRetryCount = 0;
    }
  });

  // Show a loading overlay on the current page while the next document is
  // fetched. On success the overlay dies with the old document; it only needs
  // an explicit hide when the navigation never commits.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;

    mainWindow.webContents.send(SHOW_LOADER_CHANNEL);
  });

  // Commit means the new document is rendering; a show-loader that raced onto
  // it (see comment above) must not sit over the fresh page until finish-load.
  // Exception: the CDN answers over-limit navigations (fast click bursts)
  // with an empty 429 document — Chromium renders that empty body, which is
  // the "black screen". Keep the loader up and retry the real page instead.
  mainWindow.webContents.on('did-navigate', (event, url, httpResponseCode, httpStatusText) => {
    lastDocumentHttpError = httpResponseCode >= 400;

    if (!lastDocumentHttpError) {
      mainWindow.webContents.send(HIDE_LOADER_CHANNEL);
      return;
    }

    logToFile(`document ${httpResponseCode} ${httpStatusText || ''} ${url}`);
    mainWindow.webContents.send(SHOW_LOADER_CHANNEL, { waiting: true });
    // The CDN's 429 is a client-keyed temporal ban that eager retries appear
    // to refresh (observed: 15s-cadence retries stayed banned for 2+ minutes
    // while a fresh client got 200). Retry patiently so the ban can expire.
    scheduleLoadRetry(url, false, httpResponseCode === 429 ? 30000 : 0);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame) return;

    mainWindow.webContents.send(HIDE_LOADER_CHANNEL);

    // ERR_ABORTED (-3) is a cancelled navigation (e.g. a quick follow-up
    // click), not a failure worth retrying.
    if (errorCode === -3) return;

    logToFile(`did-fail-load ${errorCode} (${errorDescription}) ${url}`);

    // ERR_FAILED (-2) is Chromium's generic failure and is what a corrupt
    // cache entry surfaces as; treat it like an explicit cache error.
    scheduleLoadRetry(url, isCacheError(errorCode) || errorCode === -2);
  });

  // Failed subresource fetches (e.g. CSS that never arrives) surface as
  // renderer console errors, not did-fail-load — capture those too.
  mainWindow.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    const level = event.level !== undefined ? event.level : legacyLevel;
    const message = event.message !== undefined ? event.message : legacyMessage;
    if (level === 'error' || level === 3) {
      logToFile(`renderer: ${message}`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logToFile(`render-process-gone: ${details.reason}`);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;

    // Do not let F11 put the borderless window back onto the Windows native
    // fullscreen path that produces ghost Alt+Tab entries.
    if (input.key === 'F11') {
      event.preventDefault();
      return;
    }

    // Handled in the main process so it works even when the page's own
    // JavaScript is hung and in-page UI can no longer respond.
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      mainWindow.webContents.reloadIgnoringCache();
      return;
    }

    if (input.key !== 'Escape') return;

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
    clearTimeout(loadRetryTimer);
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

// Exit and reload are harmless and must keep working even when the window is
// stuck on Chromium's error page (whose URL fails the amongdemons check), so
// they only verify the sender is the game window.
function isMainWindowSender(event) {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

ipcMain.on(EXIT_GAME_CHANNEL, (event) => {
  if (!isMainWindowSender(event)) return;

  app.quit();
});

ipcMain.on(RELOAD_GAME_CHANNEL, (event) => {
  if (!isMainWindowSender(event)) return;

  // A manual reload starts a fresh attempt: drop any pending auto-retry.
  clearTimeout(loadRetryTimer);
  loadRetryCount = 0;
  mainWindow.webContents.reloadIgnoringCache();
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
    rotateLogIfLarge();
    logToFile(`wrapper start v${app.getVersion()}`);
    installStallLogger(session.defaultSession);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
