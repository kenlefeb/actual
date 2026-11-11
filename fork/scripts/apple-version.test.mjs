// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { appleVersion } from './apple-version.mjs';

void test('Apple version: patch 0 alpha and stable', () => {
  assert.equal(appleVersion('26.10.0-alpha.1'), '26.10.1');
  assert.equal(appleVersion('26.10.0'), '26.10.9999');
});

void test('Apple version: patch 1 alpha and stable', () => {
  assert.equal(appleVersion('26.10.1-alpha.34'), '26.10.10034');
  assert.equal(appleVersion('26.10.1-alpha.9998'), '26.10.19998');
  assert.equal(appleVersion('26.10.1'), '26.10.19999');
});

void test('Apple version: patch 10 sorts above patch 1', () => {
  assert.equal(appleVersion('26.10.10-alpha.1'), '26.10.100001');
  assert.equal(appleVersion('26.10.10'), '26.10.109999');
});

void test('Apple version: an alpha above 9998 fails', () => {
  assert.throws(() => appleVersion('26.10.1-alpha.9999'), /9998/);
  assert.throws(() => appleVersion('26.10.1-alpha.10000'), /9998/);
});

void test('Apple version: alpha 0 and other prereleases fail', () => {
  assert.throws(() => appleVersion('26.10.1-alpha.0'));
  assert.throws(() => appleVersion('26.10.1-beta.1'));
  assert.throws(() => appleVersion('26.10'));
});
