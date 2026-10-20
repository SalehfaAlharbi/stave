import * as api from '../api.js';

const MODES = {
  signin: { title: 'Sign in', submit: 'Sign in', password: 'current-password' },
  setup: { title: 'Set up Stave', submit: 'Create account', password: 'new-password' },
  join: { title: 'Join Stave', submit: 'Create account', password: 'new-password' },
};

/**
 * The screen shown before the app: sign in, first-run setup (needs the code
 * from the server log), or joining with an invite link. Resolves with the
 * signed-in user.
 */
export function showAuth({ mode, invite = null, invitedBy = null, notice = null }) {
  const screen = document.getElementById('auth');
  const form = screen.querySelector('form');
  const $ = (selector) => screen.querySelector(selector);
  document.body.classList.add('is-signed-out');

  function render(nextMode) {
    mode = nextMode;
    const copy = MODES[mode];
    $('#auth-title').textContent = copy.title;
    $('#auth-submit').textContent = copy.submit;
    $('#auth-password').autocomplete = copy.password;
    $('#auth-password').minLength = mode === 'signin' ? 1 : 8;
    $('#auth-code-field').hidden = mode !== 'setup';
    $('#auth-code').required = mode === 'setup';
    const intro = {
      signin: notice ?? 'Your music, from your own server.',
      setup: 'Create the admin account. The setup code is printed in the server log when Stave starts.',
      join: `${invitedBy ?? 'Someone'} invited you. Pick a name and a password.`,
    }[mode];
    $('#auth-intro').textContent = intro;
    $('#auth-hint').hidden = mode === 'signin';
    $('#auth-error').textContent = '';
  }

  render(mode);
  screen.hidden = false;
  $('#auth-name').focus();

  return new Promise((resolve) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const name = $('#auth-name').value;
      const password = $('#auth-password').value;
      const submit = $('#auth-submit');
      submit.disabled = true;
      $('#auth-error').textContent = '';
      try {
        const { user } = mode === 'signin' ? await api.signIn(name, password)
          : mode === 'setup' ? await api.setUp(name, password, $('#auth-code').value)
            : await api.register(invite, name, password);
        form.reset();
        screen.hidden = true;
        document.body.classList.remove('is-signed-out');
        history.replaceState(null, '', location.pathname + location.hash); // drop ?invite=
        resolve(user);
      } catch (err) {
        $('#auth-error').textContent = err.message;
        if (err.status === 409 && mode === 'setup') render('signin');
      } finally {
        submit.disabled = false;
      }
    };
  });
}

/** Works out which screen to show from the server's status and the URL. */
export async function authenticate() {
  const status = await api.authStatus();
  const invite = new URLSearchParams(location.search).get('invite');
  if (status.user) {
    if (invite) history.replaceState(null, '', location.pathname + location.hash);
    return status.user;
  }
  if (status.setupRequired) return showAuth({ mode: 'setup' });
  if (invite) {
    try {
      const { invitedBy } = await api.inviteInfo(invite);
      return showAuth({ mode: 'join', invite, invitedBy });
    } catch (err) {
      return showAuth({ mode: 'signin', notice: err.message });
    }
  }
  return showAuth({ mode: 'signin' });
}
