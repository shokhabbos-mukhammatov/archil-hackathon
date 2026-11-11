// Removes known secret values from text that comes back out of a call, before that text
// reaches the model, a log file or the browser.
//
// Why it is needed: the test class can read the secrets (it has no network and nothing
// writable, so it cannot send them anywhere itself). But whatever a test prints is returned
// to the model, and the model could repeat it in a later call that does have network access.
// Scrubbing closes that channel for the values the host knows about.
//
// What it catches: the exact value, and its base64, base64url, hex, URL-encoded and
// JSON-escaped forms. What it does not catch: a value that is split, reversed, or encoded
// some other way. It narrows the channel; the per-call limits remain the main protection.

export const REDACTED = '[REDACTED]';
export const MIN_SECRET_LENGTH = 8;

export function variants(secret) {
  const s = String(secret);
  const b = Buffer.from(s, 'utf8');
  const forms = new Set([
    s,
    b.toString('base64'),
    b.toString('base64').replace(/=+$/, ''),
    b.toString('base64url'),
    b.toString('hex'),
    b.toString('hex').toUpperCase(),
    encodeURIComponent(s),
    JSON.stringify(s).slice(1, -1),
  ]);
  // Longest first, so a longer form is never left half-replaced by a shorter one.
  return [...forms].filter((v) => v.length >= MIN_SECRET_LENGTH).sort((x, y) => y.length - x.length);
}

// Returns the scrubbed text and how many occurrences were removed. Values shorter than
// MIN_SECRET_LENGTH are ignored: replacing short strings would mangle ordinary output.
export function scrub(text, secrets = []) {
  let out = String(text ?? '');
  let hits = 0;
  for (const secret of secrets) {
    if (secret == null || String(secret).length < MIN_SECRET_LENGTH) continue;
    for (const form of variants(secret)) {
      const parts = out.split(form);
      if (parts.length > 1) {
        hits += parts.length - 1;
        out = parts.join(REDACTED);
      }
    }
  }
  return { text: out, hits };
}
