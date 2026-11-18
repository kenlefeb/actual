// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { findTestHooks, HOOK_MARKERS } from './check-test-hooks.mjs';

function build(files) {
  const dir = mkdtempSync(join(tmpdir(), 'test-hooks-'));
  mkdirSync(join(dir, 'kcab'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

void test('Test hooks: a clean build passes', () => {
  const dir = build({
    'index.js': 'page',
    'kcab/kcab.worker.abc.js': 'worker',
  });
  assert.deepEqual(findTestHooks(dir), []);
});

void test('Test hooks: names the worker bundle holding a marker', () => {
  const dir = build({
    'index.js': 'page',
    'kcab/kcab.worker.abc.js': `x(${HOOK_MARKERS[0]})`,
  });
  assert.equal(findTestHooks(dir).length, 1);
  assert.match(findTestHooks(dir)[0], /kcab\.worker\.abc\.js/);
});

// Named here, not read from HOOK_MARKERS, so dropping one from the list fails
for (const marker of ['__forkTestCommitDelayMs', '__forkTestBarrierOff']) {
  void test(`Test hooks: finds ${marker}`, () => {
    const dir = build({
      'index.js': `x(${marker})`,
      'kcab/kcab.worker.abc.js': 'worker',
    });
    assert.equal(findTestHooks(dir).length, 1);
  });
}

void test('Test hooks: a source map is not a bundle', () => {
  const dir = build({
    'kcab/kcab.worker.abc.js': 'worker',
    'kcab/kcab.worker.abc.js.map': HOOK_MARKERS[0],
  });
  assert.deepEqual(findTestHooks(dir), []);
});

void test('Test hooks: a build without the worker bundle fails', () => {
  assert.match(findTestHooks(build({ 'index.js': 'page' }))[0], /no worker/);
});
