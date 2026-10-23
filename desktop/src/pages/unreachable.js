// Shown when the server can't be reached. Checks quietly every few seconds
// and goes back to Stave as soon as it answers.
const $ = (id) => document.getElementById(id);
const api = window.staveSetup;
const params = new URLSearchParams(location.search);
const CHECK_EVERY_MS = 5000;

$('address').textContent = params.get('server') ?? 'your server';
$('detail').textContent = params.get('error') ? `(${params.get('error')})` : '';

$('retry').addEventListener('click', () => {
  $('retry').disabled = true;
  $('status').textContent = 'Connecting…';
  api.retry();
});
$('change').addEventListener('click', () => api.changeServer());

async function check() {
  const { current } = await api.getServer();
  const result = await api.checkServer(current);
  if (result.ok) api.retry();
  else setTimeout(check, CHECK_EVERY_MS);
}
setTimeout(check, CHECK_EVERY_MS);
document.body.dataset.ready = 'true';
