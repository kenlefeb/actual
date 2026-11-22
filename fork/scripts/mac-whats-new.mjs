// Fork-only (sc-4953): the "What to Test" text of a Mac TestFlight build: the
// version and commit, then the version's release note when
// fork/release-notes/<version>.md exists. TestFlight accepts at most 4000
// characters. Run with `node fork/scripts/mac-whats-new.mjs <version> <commit>`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WHATS_NEW_LIMIT = 4000;

export function macWhatsNew(
  version,
  commit,
  notesDir = fileURLToPath(new URL('../release-notes/', import.meta.url)),
) {
  if (!/^\d+\.\d+\.\d+(-alpha\.\d+)?$/.test(version)) {
    throw new Error(`${version} is not a version`);
  }
  const head = `Version ${version}, commit ${commit}`;
  const file = `${notesDir.replace(/\/?$/, '/')}${version}.md`;
  if (!existsSync(file)) return head;
  const text = `${head}\n\n${readFileSync(file, 'utf8').trim()}`;
  const chars = [...text];
  return chars.length <= WHATS_NEW_LIMIT
    ? text
    : `${chars.slice(0, WHATS_NEW_LIMIT - 1).join('')}…`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(macWhatsNew(process.argv[2], process.argv[3]));
}
