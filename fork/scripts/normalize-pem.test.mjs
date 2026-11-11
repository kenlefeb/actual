// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { normalizePem } from './normalize-pem.mjs';

// A fake key body (not a real key), longer than one 64-character line.
const BODY = 'A'.repeat(64) + 'B'.repeat(64) + 'C'.repeat(20);
const PEM = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n${'B'.repeat(64)}\n${'C'.repeat(20)}\n-----END PRIVATE KEY-----\n`;

void test('PEM: a well-formed key is unchanged', () => {
  assert.equal(normalizePem(PEM), PEM);
});

void test('PEM: one line with spaces is rewrapped', () => {
  assert.equal(
    normalizePem(
      `-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----`,
    ),
    PEM,
  );
});

void test('PEM: literal \\n and CRLF are repaired', () => {
  assert.equal(normalizePem(PEM.replace(/\n/g, '\\n')), PEM);
  assert.equal(normalizePem(PEM.replace(/\n/g, '\r\n')), PEM);
});

void test('PEM: base64 of the whole file is decoded', () => {
  assert.equal(normalizePem(Buffer.from(PEM).toString('base64')), PEM);
});

void test('PEM: text without a key fails', () => {
  assert.throws(() => normalizePem('not a key'), /BEGIN/);
});
