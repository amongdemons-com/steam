const { contextBridge, ipcRenderer } = require('electron');

const SHOW_EXIT_DIALOG_CHANNEL = 'steam:show-exit-dialog';
const EXIT_GAME_CHANNEL = 'steam:exit-game';
const GET_AUTH_TICKET_CHANNEL = 'steam:get-auth-ticket';
const UNLOCK_ACHIEVEMENT_CHANNEL = 'steam:unlock-achievement';
const SHOW_LOADER_CHANNEL = 'steam:show-loader';
const HIDE_LOADER_CHANNEL = 'steam:hide-loader';
const RELOAD_GAME_CHANNEL = 'steam:reload-game';
const MODAL_ID = 'among-demons-steam-exit';
const LOADER_ID = 'among-demons-steam-loader';

contextBridge.exposeInMainWorld('steamBridge', {
  isSteam: true,
  getAuthTicket: () => ipcRenderer.invoke(GET_AUTH_TICKET_CHANNEL),
  unlockAchievement: (name) => ipcRenderer.invoke(UNLOCK_ACHIEVEMENT_CHANNEL, String(name)),
  // Opens the same Escape confirm dialog; used by the website's wrapper-only
  // exit button in the navbar.
  requestExit: () => showExitDialog()
});

let modal = null;
let panel = null;
let continueButton = null;
let exitButton = null;
let reloadButton = null;
let reloadResetTimer = null;
let lastFocusedElement = null;
let previousBodyOverflow = '';
let showWhenReady = false;

function createExitDialog() {
  if (modal || !document.body) return;

  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'steam-exit-modal';
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="steam-exit-backdrop" aria-hidden="true"></div>
    <section class="steam-exit-panel" role="dialog" aria-modal="true" aria-labelledby="steamExitTitle" tabindex="-1">
      <header class="steam-exit-header">
        <h2 id="steamExitTitle">Do you really want to exit?</h2>
      </header>
      <footer class="steam-exit-actions">
        <button type="button" class="btn btn-secondary steam-exit-button steam-exit-reload" title="Reload game" aria-label="Reload game">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        </button>
        <button type="button" class="btn btn-secondary steam-exit-button steam-exit-continue">Cancel</button>
        <button type="button" class="btn btn-primary steam-exit-button steam-exit-confirm">Exit</button>
      </footer>
    </section>
  `;

  panel = modal.querySelector('.steam-exit-panel');
  continueButton = modal.querySelector('.steam-exit-continue');
  exitButton = modal.querySelector('.steam-exit-confirm');
  reloadButton = modal.querySelector('.steam-exit-reload');

  continueButton.addEventListener('click', hideExitDialog);
  exitButton.addEventListener('click', () => {
    exitButton.disabled = true;
    exitButton.textContent = 'Exiting...';
    ipcRenderer.send(EXIT_GAME_CHANNEL);
  });
  reloadButton.addEventListener('click', () => {
    // Disable only against double-clicks: if the reload fails this document
    // stays alive, so the button must come back for another attempt.
    reloadButton.disabled = true;
    clearTimeout(reloadResetTimer);
    reloadResetTimer = setTimeout(() => {
      reloadButton.disabled = false;
    }, 5000);
    ipcRenderer.send(RELOAD_GAME_CHANNEL);
  });
  modal.addEventListener('keydown', keepFocusInsideDialog);

  document.body.appendChild(modal);

  if (showWhenReady) {
    showWhenReady = false;
    showExitDialog();
  }
}

function showExitDialog() {
  if (!modal) {
    showWhenReady = true;
    return;
  }

  // Escape acts as a toggle: pressing it with the dialog open closes it.
  if (!modal.hidden) {
    hideExitDialog();
    return;
  }

  lastFocusedElement = document.activeElement;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  // Focus the panel itself, not a button: nothing looks pre-selected, but
  // keyboard users can still Tab to Reload/Exit/Continue.
  panel.focus();
}

function hideExitDialog() {
  if (!modal || modal.hidden) return;

  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;

  if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  }
}

function keepFocusInsideDialog(event) {
  if (event.key !== 'Tab') return;

  const firstButton = reloadButton;
  const lastButton = exitButton;

  if (event.shiftKey && document.activeElement === firstButton) {
    event.preventDefault();
    lastButton.focus();
  } else if (!event.shiftKey && document.activeElement === lastButton) {
    event.preventDefault();
    firstButton.focus();
  }
}

let loader = null;
let loaderText = null;
let loaderSafetyTimer = null;

function showLoader(options) {
  if (!document.body) return;

  if (!loader) {
    loader = document.createElement('div');
    loader.id = LOADER_ID;
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML =
      '<div class="steam-loader-inner">'
      + '<div class="steam-loader-spinner"></div>'
      + '<div class="steam-loader-text">Waiting for server ...</div>'
      + '</div>';
    loaderText = loader.querySelector('.steam-loader-text');
    document.body.appendChild(loader);
  }

  // "Waiting" mode is used on server-error documents (e.g. a CDN 429): the
  // page behind the overlay is empty, so tell the player what is happening
  // while the wrapper retries in the background.
  const waiting = Boolean(options && options.waiting);
  loaderText.hidden = !waiting;
  loader.hidden = false;

  // Safety valve: a navigation that stalls without ever failing sends no
  // hide message, and the overlay must not blind a real page forever. Error
  // documents have nothing to blind, and each retry re-shows the overlay, so
  // waiting mode can stay up much longer.
  clearTimeout(loaderSafetyTimer);
  loaderSafetyTimer = setTimeout(hideLoader, waiting ? 45000 : 12000);
}

function hideLoader() {
  clearTimeout(loaderSafetyTimer);
  if (loader) loader.hidden = true;

  // Hide-loader on a still-alive document means a navigation failed; re-arm
  // the reload button right away instead of waiting out its cooldown.
  if (reloadButton) {
    clearTimeout(reloadResetTimer);
    reloadButton.disabled = false;
  }
}

ipcRenderer.on(SHOW_EXIT_DIALOG_CHANNEL, showExitDialog);
ipcRenderer.on(SHOW_LOADER_CHANNEL, (event, options) => showLoader(options));
ipcRenderer.on(HIDE_LOADER_CHANNEL, hideLoader);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', createExitDialog, { once: true });
} else {
  createExitDialog();
}
