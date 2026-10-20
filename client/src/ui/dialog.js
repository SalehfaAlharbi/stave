// One shared modal <dialog> for naming, confirming and showing a link. The
// native element traps focus, handles Escape and marks the rest inert.

const dialog = document.getElementById('dialog');
const form = dialog.querySelector('form');
const titleEl = dialog.querySelector('.dialog-title');
const messageEl = dialog.querySelector('.dialog-message');
const field = dialog.querySelector('.dialog-field');
const labelEl = field.querySelector('label');
const input = field.querySelector('input');
const confirmButton = dialog.querySelector('.dialog-confirm');
const cancelButton = dialog.querySelector('.dialog-cancel');
const copyButton = dialog.querySelector('.dialog-copy');

// The answer for the dialog that is open now. Each way of closing settles it
// directly instead of waiting for the "close" event, which is queued and not
// always delivered promptly (it never arrived in a background tab in testing).
let settle = null;

function finish(value) {
  const done = settle;
  settle = null;
  if (dialog.open) dialog.close();
  done?.(value);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!settle) return;
  const { prompt } = dialog.dataset;
  if (prompt === 'edit' && !input.value.trim()) {
    input.focus();
    return;
  }
  finish(prompt === 'edit' ? input.value.trim() : true);
});
cancelButton.addEventListener('click', () => finish(null));
dialog.addEventListener('cancel', () => finish(null)); // Escape
dialog.addEventListener('close', () => {
  // Anything else that closed it. A late event from the previous dialog must
  // not dismiss one that has opened since.
  if (!dialog.open) finish(null);
});

copyButton.addEventListener('click', async () => {
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    copyButton.textContent = 'Copied';
  } catch {
    // No clipboard access over plain HTTP on another device: the link is selected, so Ctrl+C works.
    copyButton.textContent = 'Press Ctrl+C to copy';
  }
});

/**
 * Shows the dialog and resolves with the input's value (for a prompt), true
 * (for a confirm) or null if dismissed.
 */
export function openDialog({ title, message = '', input: inputOptions, confirm = 'OK', danger = false, cancel = 'Cancel', copy = false }) {
  finish(null); // a dialog still open is dismissed

  titleEl.textContent = title;
  messageEl.textContent = message;
  messageEl.hidden = !message;
  field.hidden = !inputOptions;
  dialog.dataset.prompt = !inputOptions ? 'none' : inputOptions.readOnly ? 'show' : 'edit';
  if (inputOptions) {
    labelEl.textContent = inputOptions.label;
    input.value = inputOptions.value ?? '';
    input.readOnly = Boolean(inputOptions.readOnly);
    input.maxLength = inputOptions.maxLength ?? 100;
  }
  confirmButton.textContent = confirm;
  confirmButton.classList.toggle('is-danger', danger);
  cancelButton.textContent = cancel ?? '';
  cancelButton.hidden = cancel === null;
  copyButton.hidden = !copy;
  copyButton.textContent = 'Copy link';

  return new Promise((resolve) => {
    settle = resolve;
    dialog.showModal();
    if (inputOptions) {
      input.focus();
      input.select();
    }
  });
}
