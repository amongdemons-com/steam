const { ipcRenderer } = require('electron');

const SHOW_EXIT_DIALOG_CHANNEL = 'steam:show-exit-dialog';
const EXIT_GAME_CHANNEL = 'steam:exit-game';
const MODAL_ID = 'among-demons-steam-exit';

let modal = null;
let continueButton = null;
let exitButton = null;
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
    <section class="steam-exit-panel" role="dialog" aria-modal="true" aria-labelledby="steamExitTitle">
      <header class="steam-exit-header">
        <h2 id="steamExitTitle">Do you really want to exit?</h2>
      </header>
      <footer class="steam-exit-actions">
        <button type="button" class="btn btn-glass-danger steam-exit-button steam-exit-confirm">Exit</button>
        <button type="button" class="btn btn-glass-muted steam-exit-button steam-exit-continue">Continue</button>
      </footer>
    </section>
  `;

  continueButton = modal.querySelector('.steam-exit-continue');
  exitButton = modal.querySelector('.steam-exit-confirm');

  continueButton.addEventListener('click', hideExitDialog);
  exitButton.addEventListener('click', () => {
    exitButton.disabled = true;
    exitButton.textContent = 'Exiting...';
    ipcRenderer.send(EXIT_GAME_CHANNEL);
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

  if (!modal.hidden) {
    continueButton.focus();
    return;
  }

  lastFocusedElement = document.activeElement;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  continueButton.focus();
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

  const firstButton = exitButton;
  const lastButton = continueButton;

  if (event.shiftKey && document.activeElement === firstButton) {
    event.preventDefault();
    lastButton.focus();
  } else if (!event.shiftKey && document.activeElement === lastButton) {
    event.preventDefault();
    firstButton.focus();
  }
}

ipcRenderer.on(SHOW_EXIT_DIALOG_CHANNEL, showExitDialog);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', createExitDialog, { once: true });
} else {
  createExitDialog();
}
