// Removes known secret values from text that comes back out of a call, before that text
// reaches the model, a log file or the browser, and spots them in text about to go out.
//
// In this design the API key never enters a call (Archil adds it at the network edge), so
// scrubbing is a second line of defence: it matters if a service ever echoes the key, or for
// any secret a project does have to put inside a call.
//
// What it catches: the value in any letter case and reversed; its hex; its URL-encoded and
// JSON-escaped forms; and its base64 or base64url at any byte alignment, so the value is
// also caught when it sits inside a larger block that was base64-encoded as a whole (a
// config file, say). What it cannot catch: a value split up, re-encoded some other way, or
// encrypted. It narrows the channel; it does not close it.

export const REDACTED = '[REDACTED]';
export const MIN_SECRET_LENGTH = 8;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The base64 characters that depend only on the secret's own bytes, for each of the three
// positions it can start at relative to base64's 3-byte groups. Whatever surrounds the
// secret, one of these appears in the encoding of the whole.
function base64Cores(bytes) {
  const cores = [];
  for (let k = 0; k < 3; k++) {
    const enc = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    const core = enc.slice(Math.ceil(k / 3) * 4, Math.floor((k + bytes.length) / 3) * 4);
    cores.push(core, core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return cores;
}

export function patternsFor(secret) {
  const s = String(secret);
  const bytes = Buffer.from(s, 'utf8');
  const keep = (list) => [...new Set(list)].filter((v) => v.length >= MIN_SECRET_LENGTH).sort((x, y) => y.length - x.length);
  return {
    // Matched ignoring letter case.
    anyCase: keep([s, [...s].reverse().join(''), bytes.toString('hex'), encodeURIComponent(s), JSON.stringify(s).slice(1, -1)]),
    // base64 is case-sensitive.
    exact: keep(base64Cores(bytes)),
  };
}

// Returns the scrubbed text and how many occurrences were removed. Values shorter than
// MIN_SECRET_LENGTH are ignored: replacing short strings would mangle ordinary output.
export function scrub(text, secrets = []) {
  let out = String(text ?? '');
  let hits = 0;
  for (const secret of secrets) {
    if (secret == null || String(secret).length < MIN_SECRET_LENGTH) continue;
    const { anyCase, exact } = patternsFor(secret);
    for (const [list, flags] of [[anyCase, 'gi'], [exact, 'g']]) {
      if (!list.length) continue;
      out = out.replace(new RegExp(list.map(escapeRe).join('|'), flags), () => { hits++; return REDACTED; });
    }
  }
  return { text: out, hits };
}

export const containsSecret = (text, secrets) => scrub(text, secrets).hits > 0;
