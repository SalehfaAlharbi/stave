/** Small status cards above the player bar (upload progress, playback errors). */
export function createToasts(container) {
  return {
    show({ title, detail = '', error = false, timeout = 6000 }) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');

      const head = document.createElement('div');
      head.className = 'toast-head';
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      const close = document.createElement('button');
      close.className = 'toast-close';
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss');
      close.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
      head.append(titleEl, close);

      const detailEl = document.createElement('div');
      detailEl.className = 'toast-detail';
      const bar = document.createElement('div');
      bar.className = 'toast-progress';
      bar.hidden = true;
      const fill = document.createElement('span');
      bar.append(fill);
      const list = document.createElement('ul');
      list.className = 'toast-errors';
      toast.append(head, detailEl, bar, list);
      container.append(toast);

      let timer;
      const dismiss = () => {
        clearTimeout(timer);
        toast.remove();
      };
      const autoDismiss = (ms) => {
        clearTimeout(timer);
        if (ms) timer = setTimeout(dismiss, ms);
      };
      close.addEventListener('click', dismiss);

      const handle = {
        update({ title: t, detail: d, error: e = false }) {
          titleEl.textContent = t;
          detailEl.textContent = d ?? '';
          detailEl.hidden = !d;
          toast.classList.toggle('is-error', e);
        },
        progress(fraction) {
          bar.hidden = fraction == null;
          fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
        },
        errors(items) {
          list.replaceChildren(...items.map(({ name, reason }) => {
            const li = document.createElement('li');
            const strong = document.createElement('strong');
            strong.textContent = name;
            li.append(strong, document.createTextNode(` ${reason}`));
            return li;
          }));
        },
        autoDismiss,
        dismiss,
      };
      handle.update({ title, detail, error });
      autoDismiss(timeout);
      return handle;
    },
  };
}
