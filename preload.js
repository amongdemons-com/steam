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
    reloadButton.disabled = true;
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

function showLoader() {
  if (!document.body) return;

  if (!loader) {
    loader = document.createElement('div');
    loader.id = LOADER_ID;
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML = '<div class="steam-loader-spinner"></div>';
    document.body.appendChild(loader);
  }

  loader.hidden = false;
}

function hideLoader() {
  if (loader) loader.hidden = true;
}

ipcRenderer.on(SHOW_EXIT_DIALOG_CHANNEL, showExitDialog);
ipcRenderer.on(SHOW_LOADER_CHANNEL, showLoader);
ipcRenderer.on(HIDE_LOADER_CHANNEL, hideLoader);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', createExitDialog, { once: true });
} else {
  createExitDialog();
}
