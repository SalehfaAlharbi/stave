// One shared pop-up menu (row actions, playlist actions, the account menu).
// Uses the Popover API, so the browser handles the top layer, Escape and
// clicking outside; this file positions it and adds arrow-key navigation.

const menu = document.getElementById('menu');
let anchor = null;

menu.addEventListener('toggle', (event) => {
  if (event.newState === 'closed') {
    anchor?.setAttribute('aria-expanded', 'false');
    // Give focus back to the button that opened the menu, unless the user clicked elsewhere.
    if (anchor && (document.activeElement === document.body || menu.contains(document.activeElement))) anchor.focus();
    anchor = null;
  }
});

menu.addEventListener('keydown', (event) => {
  const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  const moves = { ArrowDown: 1, ArrowUp: -1 };
  if (event.key in moves) {
    items[(index + moves[event.key] + items.length) % items.length]?.focus();
  } else if (event.key === 'Home') {
    items[0]?.focus();
  } else if (event.key === 'End') {
    items.at(-1)?.focus();
  } else if (event.key === 'Tab') {
    menu.hidePopover();
    return;
  } else {
    return;
  }
  event.preventDefault();
});

function place(button) {
  const box = button.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.right - width), innerWidth - width - 8);
  const below = box.bottom + 6;
  const top = below + height > innerHeight - 8 ? Math.max(8, box.top - height - 6) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * Opens the menu next to `button`. Items: { label, onSelect, danger, disabled }
 * or { heading } for a label row.
 */
export function openMenu(button, items, { label } = {}) {
  if (menu.matches(':popover-open')) menu.hidePopover();
  menu.replaceChildren(...items.map((item) => {
    if (item.heading) {
      const heading = document.createElement('div');
      heading.className = 'menu-heading';
      heading.setAttribute('role', 'presentation');
      heading.textContent = item.heading;
      return heading;
    }
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = `menu-item${item.danger ? ' is-danger' : ''}`;
    entry.setAttribute('role', 'menuitem');
    entry.textContent = item.label;
    entry.disabled = Boolean(item.disabled);
    entry.addEventListener('click', () => {
      menu.hidePopover();
      item.onSelect();
    });
    return entry;
  }));
  menu.setAttribute('aria-label', label ?? 'Options');
  anchor = button;
  button.setAttribute('aria-expanded', 'true');
  menu.showPopover();
  place(button);
  menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
}
