/**
 * Songs, Liked Songs and the user's playlists. The "+" next to Playlists
 * opens an inline name field: Enter creates, Escape or an empty blur cancels.
 */
export function createSidebar({ list, addButton, form, onCreate }) {
  const input = form.querySelector('input');
  let active = 'songs';

  function closeForm() {
    form.hidden = true;
    input.value = '';
    addButton.setAttribute('aria-expanded', 'false');
  }

  addButton.addEventListener('click', () => {
    form.hidden = false;
    addButton.setAttribute('aria-expanded', 'true');
    input.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    closeForm();
    await onCreate(name);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeForm();
      addButton.focus();
    }
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) closeForm();
  });

  function markActive() {
    for (const link of document.querySelectorAll('[data-nav]')) {
      const on = link.dataset.nav === active;
      link.classList.toggle('is-active', on);
      if (on) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  return {
    render(playlists) {
      list.replaceChildren(...playlists.map((playlist) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'nav-item nav-playlist';
        link.href = `#/playlist/${playlist.id}`;
        link.dataset.nav = `playlist:${playlist.id}`;
        link.textContent = playlist.name;
        li.append(link);
        return li;
      }));
      markActive();
    },
    setActive(key) {
      active = key;
      markActive();
    },
  };
}
