// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import {
  findDrift,
  PACKAGES,
  readVersions,
} from './check-package-versions.mjs';

void test('Versions drift: names the package that differs', () => {
  const versions = Object.fromEntries(
    PACKAGES.map(name => [name, '26.10.1-alpha.21']),
  );
  versions['@actual-app/mcp'] = '26.10.1-alpha.20';
  const drift = findDrift(versions);
  assert.equal(drift.length, 1);
  assert.match(drift[0], /@actual-app\/mcp/);
});

void test('Versions drift: passes when all eight match', () => {
  assert.equal(PACKAGES.length, 8);
  assert.ok(PACKAGES.includes('@actual-app/mcp'));
  const versions = Object.fromEntries(PACKAGES.map(name => [name, '1.2.3']));
  assert.deepEqual(findDrift(versions), []);
});

void test('Versions drift: this checkout is aligned', () => {
  const root = new URL('../..', import.meta.url).pathname;
  assert.deepEqual(
    findDrift(readVersions(root, p => readFileSync(p, 'utf8'))),
    [],
  );
});
