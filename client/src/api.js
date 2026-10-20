// Calls to the Stave server, which serves this client from the same origin,
// so the session cookie goes along with every request automatically.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Fired when the server says the session is gone; main.js shows the sign-in screen. */
export const SIGNED_OUT = 'stave:signed-out';

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(SIGNED_OUT));
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `Request failed (${res.status}).`);
  return data;
}

// ---- Accounts ----

export const authStatus = () => request('/api/auth/status');
export const signIn = (name, password) => request('/api/auth/login', { method: 'POST', body: { name, password } });
export const setUp = (name, password, code) => request('/api/auth/setup', { method: 'POST', body: { name, password, code } });
export const register = (code, name, password) => request('/api/auth/register', { method: 'POST', body: { code, name, password } });
export const signOut = () => request('/api/auth/logout', { method: 'POST' });
export const inviteInfo = (code) => request(`/api/invites/${encodeURIComponent(code)}`);
export const createInvite = () => request('/api/invites', { method: 'POST' });

// ---- Library ----

/** All tracks, newest first, or those matching every word of `query`. */
export async function listTracks(query = '', { signal } = {}) {
  const q = query.trim();
  return (await request(q ? `/api/tracks?q=${encodeURIComponent(q)}` : '/api/tracks', { signal })).tracks;
}
export const deleteTrack = (id) => request(`/api/tracks/${id}`, { method: 'DELETE' });

// ---- Liked Songs and playlists ----

export const likedTracks = async ({ signal } = {}) => (await request('/api/likes', { signal })).tracks;
export const like = (trackId) => request(`/api/likes/${trackId}`, { method: 'PUT' });
export const unlike = (trackId) => request(`/api/likes/${trackId}`, { method: 'DELETE' });

export const listPlaylists = async () => (await request('/api/playlists')).playlists;
export const getPlaylist = (id, { signal } = {}) => request(`/api/playlists/${id}`, { signal });
export const createPlaylist = (name) => request('/api/playlists', { method: 'POST', body: { name } });
export const renamePlaylist = (id, name) => request(`/api/playlists/${id}`, { method: 'PATCH', body: { name } });
export const deletePlaylist = (id) => request(`/api/playlists/${id}`, { method: 'DELETE' });
export const addToPlaylist = (id, trackId) => request(`/api/playlists/${id}/tracks`, { method: 'POST', body: { trackId } });
export const removeFromPlaylist = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' });

// ---- Uploads ----

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
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) window.dispatchEvent(new Event(SIGNED_OUT));
      resolve({ status: xhr.status, body: xhr.response });
    });
    xhr.addEventListener('error', () => reject(new Error('Could not reach the Stave server.')));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}
