// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { findSwiftFiles, problems } from './check-native-swift.mjs';

// native-bridge: "Only loot-core touches the budget data" (sc-3584)
void test('Native Swift: fails on a SQLite import and names the file', () => {
  for (const line of [
    'import SQLite3',
    'import sqlite3',
    '@testable import GRDB',
    'import SQLite',
  ]) {
    const found = problems({ 'App/Bad.swift': `import UIKit\n${line}\n` });
    assert.equal(found.length, 1, line);
    assert.match(found[0], /App\/Bad\.swift/);
  }
});

void test('Native Swift: fails on a .sqlite path', () => {
  const found = problems({
    'App/Path.swift': 'let url = dir.appendingPathComponent("db.sqlite")\n',
  });
  assert.equal(found.length, 1);
});

void test('Native Swift: passes on bridge code', () => {
  assert.deepEqual(
    problems({ 'App/Ok.swift': 'import WebKit\nimport Capacitor\n' }),
    [],
  );
});

void test('Native Swift: this checkout is clean', () => {
  const root = new URL('../..', import.meta.url).pathname;
  const files = findSwiftFiles(root);
  assert.ok(Object.keys(files).length > 0);
  assert.deepEqual(problems(files), []);
});
