// Pure text clean-up applied to whatever the page extractor returns.
// No DOM access; unit-tested in Node.

export const MAX_CAPTURE_CHARS = 400_000; // server rejects longer text (413 too_large)

/**
 * Normalise captured text: NFC, no control or zero-width characters, single
 * spaces, trimmed lines, at most one blank line in a row. Wording is never
 * changed, reordered or de-duplicated.
 */
export function cleanText(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  let text = raw.normalize('NFC').replace(/\r\n?/g, '\n');
  // Control chars (keep \n and \t), zero-width and bidi marks, soft hyphen, BOM.
  text = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g, '');
  const lines = text.split('\n').map((line) => line.replace(/[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ').trim());

  const out = [];
  for (const line of lines) {
    if (line !== '') out.push(line);
    else if (out.length && out[out.length - 1] !== '') out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** Cut text to the server limit without splitting a surrogate pair. */
export function limitText(text, max = MAX_CAPTURE_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut.trimEnd(), truncated: true };
}

export function cleanTitle(raw) {
  return cleanText(String(raw ?? '')).replace(/\n+/g, ' ').slice(0, 300).trim();
}

export function formatCount(n) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'character' : 'characters'}`;
}
