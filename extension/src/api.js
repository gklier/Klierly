// Settings storage and the two calls to the user's own Klierly server.
// Contract: docs/CONTRACTS.md section 2 (/api/ext/*).

export const DEFAULT_SERVER_URL = 'http://localhost:3000';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Validate a user-entered server address and reduce it to its origin.
 * https is required unless the host is localhost / 127.0.0.1.
 */
export function normalizeServerUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter the address of your Klierly server.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid address. Example: https://klierly.example.edu' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'The address must start with https:// (or http:// for localhost).' };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'Do not put a username or password in the address.' };
  }
  if (u.protocol === 'http:' && !LOCAL_HOSTS.has(u.hostname)) {
    return { ok: false, error: 'Use https:// for any server that is not on this computer (localhost or 127.0.0.1).' };
  }
  return { ok: true, url: u.origin };
}

export async function loadSettings() {
  const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token']);
  return { serverUrl: serverUrl || DEFAULT_SERVER_URL, token: token || '' };
}

export async function saveSettings({ serverUrl, token }) {
  await chrome.storage.local.set({ serverUrl, token });
}

export async function clearSettings() {
  await chrome.storage.local.remove(['serverUrl', 'token', 'lastCourseId', 'lastModuleId']);
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const FRIENDLY = {
  invalid_token: 'The pairing token was not accepted. Create a new one in Klierly under Settings → Browser extension and paste it in the extension settings.',
  permission_required: 'Tick the permission declaration before importing.',
  empty_capture: 'There is no text to import.',
  too_large: 'This page has too much text to import in one go. Select a smaller part of the page and try again.',
  assessment_blocked: 'Your Klierly server declined this import because the page looks like an active graded assessment.',
  course_not_found: 'That course no longer exists. Reopen the popup to reload your courses.',
  rate_limited: 'Too many imports in a short time. Wait a minute and try again.',
};

async function request(settings, path, init = {}) {
  const check = normalizeServerUrl(settings.serverUrl);
  if (!check.ok) throw new ApiError('bad_server_url', check.error, 0);
  let res;
  try {
    res = await fetch(check.url + path, {
      ...init,
      headers: { Authorization: `Bearer ${settings.token}`, ...(init.headers || {}) },
      credentials: 'omit', // never send cookies
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new ApiError('network', `Could not reach ${check.url}. Check that your Klierly server is running and the address is right.`, 0);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = body?.error?.code || `http_${res.status}`;
    const message = FRIENDLY[code] || body?.error?.message || `The server answered with an error (${res.status}).`;
    throw new ApiError(code, message, res.status);
  }
  if (!body || typeof body !== 'object') {
    throw new ApiError('bad_response', 'The server answered, but not like a Klierly server. Check the address.', res.status);
  }
  return body;
}

/** GET /api/ext/courses — sends only the pairing token. */
export async function fetchCourses(settings) {
  const body = await request(settings, '/api/ext/courses');
  if (!Array.isArray(body.courses)) {
    throw new ApiError('bad_response', 'The server answered, but not like a Klierly server. Check the address.', 200);
  }
  return body;
}

/** POST /api/ext/import — only ever called from the Import button handler. */
export async function importCapture(settings, payload) {
  return request(settings, '/api/ext/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Only http(s) links are ever rendered as clickable. */
export function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
