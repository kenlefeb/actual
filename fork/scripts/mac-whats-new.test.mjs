// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { macWhatsNew, WHATS_NEW_LIMIT } from './mac-whats-new.mjs';

function notesDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mac-whats-new-'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

void test('Mac what-to-test: no note for the version gives the version and commit', () => {
  assert.equal(
    macWhatsNew('26.10.1-alpha.50', 'abc123', notesDir({})),
    'Version 26.10.1-alpha.50, commit abc123',
  );
});

void test('Mac what-to-test: the version note follows the version and commit', () => {
  const dir = notesDir({ '26.10.1-alpha.50.md': '# Notes\n\n- A fix\n' });
  assert.equal(
    macWhatsNew('26.10.1-alpha.50', 'abc123', dir),
    'Version 26.10.1-alpha.50, commit abc123\n\n# Notes\n\n- A fix',
  );
});

void test('Mac what-to-test: a long note is cut to what Apple accepts', () => {
  const dir = notesDir({ '1.0.0.md': 'x'.repeat(10000) });
  const text = macWhatsNew('1.0.0', 'abc', dir);
  assert.equal([...text].length, WHATS_NEW_LIMIT);
  assert.ok(text.endsWith('…'));
});

void test('Mac what-to-test: a version that is not a plain name never reads another path', () => {
  assert.throws(
    () => macWhatsNew('../secret', 'abc', notesDir({})),
    /not a version/,
  );
});
