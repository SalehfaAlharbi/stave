import { uploadTrack } from '../api.js';
import { pluralize } from '../format.js';

/**
 * "Add song": pick files, or drop them anywhere on the window. Files go up
 * one at a time with a progress toast; the server decides what is audio.
 */
export function createUploader({ input, triggers, overlay, toasts, onAdded }) {
  for (const trigger of triggers) trigger.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    enqueue([...input.files]);
    input.value = '';
  });

  // Drag and drop. dragenter/dragleave fire for every child element, so count them.
  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.hidden = true;
    enqueue([...event.dataTransfer.files]);
  });

  let batches = Promise.resolve();
  function enqueue(files) {
    if (files.length) batches = batches.then(() => uploadBatch(files));
  }

  async function uploadBatch(files) {
    const toast = toasts.show({ title: 'Adding songs', timeout: 0 });
    const added = [];
    let duplicates = 0;
    const failed = [];

    for (const [i, file] of files.entries()) {
      toast.update({ title: files.length > 1 ? `Adding ${i + 1} of ${files.length}` : 'Adding song', detail: file.name });
      toast.progress(0);
      try {
        const { status, body } = await uploadTrack(file, (fraction) => toast.progress(fraction));
        if (status === 201) {
          added.push(body);
          onAdded(body);
        } else if (status === 409) {
          duplicates += 1;
        } else {
          failed.push({ name: file.name, reason: body?.message ?? `Upload failed (${status}).` });
        }
      } catch (err) {
        failed.push({ name: file.name, reason: err.message });
      }
    }

    const parts = [];
    if (added.length) parts.push(`Added ${pluralize(added.length, 'song')}`);
    if (duplicates) parts.push(`${duplicates} already in your library`);
    if (failed.length) parts.push(`${failed.length} failed`);
    toast.progress(null);
    toast.update({ title: parts.join(' · '), error: failed.length > 0 });
    toast.errors(failed);
    toast.autoDismiss(failed.length ? 15000 : 5000);
  }

  return { enqueue };
}
