// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { findNativeSources, problems } from './check-native-swift.mjs';

// native-bridge: "Only loot-core touches the budget data" (sc-3584)
void test('Native Swift: fails on a database import and names the file', () => {
  for (const line of [
    'import SQLite3',
    'import sqlite3',
    '@testable import GRDB',
    'import SQLite',
    'import FMDB',
    'import SQLCipher',
    'import CSQLite',
    'import CoreData',
    'import struct SQLite3.sqlite3',
    'import func SQLite3.sqlite3_open',
    'import typealias GRDB.DatabaseQueue',
    'import protocol GRDB.DatabaseReader',
    '#if canImport(SQLite3)',
    '#if canImport( GRDB )',
  ]) {
    const found = problems({ 'App/Bad.swift': `import UIKit\n${line}\n` });
    // `SQLite3.sqlite3` also trips the path rule; one failure is enough
    assert.ok(found.length >= 1, line);
    assert.match(found[0], /App\/Bad\.swift/);
  }
});

void test('Native Swift: fails on a .sqlite or .sqlite3 path', () => {
  for (const name of ['db.sqlite', 'cache.sqlite3']) {
    const found = problems({
      'App/Path.swift': `let url = dir.appendingPathComponent("${name}")\n`,
    });
    assert.equal(found.length, 1, name);
  }
});

void test('Native Swift: fails on a bridging header that includes sqlite3.h', () => {
  for (const line of ['#import <sqlite3.h>', '#include "sqlite3.h"']) {
    const found = problems({ 'App/App-Bridging-Header.h': `${line}\n` });
    assert.equal(found.length, 1, line);
    assert.match(found[0], /App-Bridging-Header\.h/);
  }
});

void test('Native Swift: passes on bridge code', () => {
  assert.deepEqual(
    problems({
      'App/Ok.swift': 'import WebKit\nimport Capacitor\nimport SQLiteLike\n',
    }),
    [],
  );
});

void test('Native Swift: scans Swift, headers and Objective-C, skipping vendored code', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-swift-'));
  const app = join(root, 'packages/mobile-client/ios/App');
  mkdirSync(join(app, 'Pods'), { recursive: true });
  for (const name of ['A.swift', 'B.h', 'C.m', 'D.mm', 'notes.md']) {
    writeFileSync(join(app, name), '');
  }
  writeFileSync(join(app, 'Pods/E.swift'), 'import SQLite3\n');
  assert.deepEqual(Object.keys(findNativeSources(root)).sort(), [
    'packages/mobile-client/ios/App/A.swift',
    'packages/mobile-client/ios/App/B.h',
    'packages/mobile-client/ios/App/C.m',
    'packages/mobile-client/ios/App/D.mm',
  ]);
});

void test('Native Swift: this checkout is clean', () => {
  const root = new URL('../..', import.meta.url).pathname;
  const files = findNativeSources(root);
  assert.ok(Object.keys(files).length > 0);
  assert.deepEqual(problems(files), []);
});
