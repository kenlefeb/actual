// Fork-only (sc-3398): rebuild the App Store Connect .p8 key from a secret that
// may have lost its line breaks (one line, literal "\n", CRLF) or be base64 of
// the whole file. xcodebuild rejects anything but a well-formed PEM. Reads the
// secret from stdin and writes the PEM to stdout, so it never reaches the log.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function normalizePem(secret) {
  let text = secret.replace(/\\n/g, '\n').replace(/\r/g, '');
  if (!text.includes('-----BEGIN')) {
    text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(
    text,
  );
  if (!match) {
    throw new Error('The secret holds no PEM BEGIN/END block');
  }
  const [, label, body] = match;
  const lines = body.replace(/\s/g, '').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(normalizePem(readFileSync(0, 'utf8')));
}
