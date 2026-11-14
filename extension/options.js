import { ApiError, clearSettings, fetchCourses, loadSettings, normalizeServerUrl, saveSettings } from './src/api.js';

const $ = (id) => document.getElementById(id);

function say(text, kind = '') {
  $('result').textContent = text;
  $('result').className = `notice ${kind}`;
  $('result').hidden = false;
}

function read() {
  const check = normalizeServerUrl($('server').value);
  if (!check.ok) { say(check.error, 'bad'); return null; }
  const token = $('token').value.trim();
  if (!/^clx_[A-Za-z0-9_-]{20,}$/.test(token)) { say('That does not look like a Klierly pairing token. It starts with clx_.', 'bad'); return null; }
  return { serverUrl: check.url, token };
}

async function test(settings) {
  try {
    const body = await fetchCourses(settings);
    say(`Connected to ${new URL(settings.serverUrl).host} as ${body.user?.email ?? 'your account'} — ${body.courses.length} ${body.courses.length === 1 ? 'course' : 'courses'}.`, 'good');
  } catch (e) {
    say(e instanceof ApiError ? e.message : 'The connection test failed.', 'bad');
  }
}

(async () => {
  const s = await loadSettings();
  $('server').value = s.serverUrl;
  $('token').value = s.token;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = read();
    if (!settings) return;
    await saveSettings(settings);
    say('Saved. Testing the connection…');
    await test(settings);
  });
  $('test').addEventListener('click', async () => { const settings = read(); if (settings) { say('Testing…'); await test(settings); } });
  $('disconnect').addEventListener('click', async () => { await clearSettings(); $('token').value = ''; say('Disconnected. The saved token was removed from this browser. Revoke it in Klierly as well if you no longer need it.'); });
})();
