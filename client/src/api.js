// Calls to the Stave server, which serves this client from the same origin.

async function errorFrom(res) {
  const body = await res.json().catch(() => null);
  return new Error(body?.message ?? `Request failed (${res.status})`);
}

/** All tracks, newest first, or those matching every word of `query`. */
export async function listTracks(query = '', { signal } = {}) {
  const q = query.trim();
  const res = await fetch(q ? `/api/tracks?q=${encodeURIComponent(q)}` : '/api/tracks', { signal });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()).tracks;
}

/**
 * Uploads one file. Uses XMLHttpRequest because fetch cannot report upload
 * progress. Resolves to { status, body }: 201 added, 409 already in the
 * library, 4xx with body.message otherwise.
 */
export function uploadTrack(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/tracks');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => resolve({ status: xhr.status, body: xhr.response }));
    xhr.addEventListener('error', () => reject(new Error('Could not reach the Stave server.')));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}
