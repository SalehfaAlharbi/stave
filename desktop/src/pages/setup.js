// The server address screen: shown on first launch and from "Change server".
const $ = (id) => document.getElementById(id);
const api = window.staveSetup;

(async () => {
  const { current, suggested, configured } = await api.getServer();
  $('address').value = current ?? suggested;
  $('cancel').hidden = !configured;
  $('address').focus();
  $('address').select();
  document.body.dataset.ready = 'true';
})();

$('cancel').addEventListener('click', () => api.retry());

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('error').textContent = '';
  $('connect').disabled = true;
  $('connect').textContent = 'Connecting…';
  const result = await api.useServer($('address').value);
  // On success the main process loads the server, so this page goes away.
  if (!result.ok) {
    $('error').textContent = result.message;
    $('connect').disabled = false;
    $('connect').textContent = 'Connect';
    $('address').focus();
  }
});
