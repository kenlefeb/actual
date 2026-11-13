// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { pngsToIco } from './generate-app-icons.mjs';

void test('App icons: the .ico directory points at each PNG in order', () => {
  const a = Buffer.from('first');
  const b = Buffer.from('second image');
  const ico = pngsToIco([
    { size: 16, png: a },
    { size: 256, png: b },
  ]);
  assert.equal(ico.readUInt16LE(2), 1); // icon type
  assert.equal(ico.readUInt16LE(4), 2); // two images
  assert.equal(ico.readUInt8(6), 16);
  assert.equal(ico.readUInt8(6 + 16), 0); // 256 is stored as 0
  const offsetA = ico.readUInt32LE(6 + 12);
  const offsetB = ico.readUInt32LE(6 + 16 + 12);
  assert.equal(ico.readUInt32LE(6 + 8), a.length);
  assert.deepEqual(ico.subarray(offsetA, offsetA + a.length), a);
  assert.deepEqual(ico.subarray(offsetB, offsetB + b.length), b);
  assert.equal(ico.length, offsetB + b.length);
});
