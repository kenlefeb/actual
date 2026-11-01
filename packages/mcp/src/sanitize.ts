export const MAX_FIELD_LENGTH = 200;
export const MAX_OUTPUT_CHARS = 60_000;

// ANSI escape sequences, then format/zero-width/bidi characters (Cf, dropped),
// then controls and line/paragraph separators (Cc, Zl, Zp, become a space).
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}[@-_]`, 'g');
const FORMAT = /\p{Cf}/gu;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** Makes untrusted text safe to hand to a model: strips, then truncates. */
export function sanitizeText(
  value: string,
  max: number = MAX_FIELD_LENGTH,
): string {
  const clean = value
    .replace(ANSI, '')
    .replace(FORMAT, '')
    .replace(CONTROL, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

/** Sanitizes every string (and key) in a JSON-like value. */
export function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [sanitizeText(k), sanitizeDeep(v)]),
    );
  }
  return value;
}

export function scrubSecrets(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function capOutput(json: string): string {
  if (json.length <= MAX_OUTPUT_CHARS) return json;
  return JSON.stringify({
    error: 'Result too large. Use a smaller limit or narrower filters.',
  });
}
