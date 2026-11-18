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

// native-bridge: "Swift calls into the page only while it is the app's own page" (sc-3859)
const CHECKED_PATH =
  'packages/mobile-client/ios/NativeBridge/Sources/NativeBridgeCore/PageOriginGuard.swift';
const SCRIPT_ALLOWED =
  'packages/mobile-client/ios/App/App/NativeChromePlugin.swift';

void test('Native Swift: fails on a call into the page outside the checked path', () => {
  for (const line of [
    'webView.callAsyncJavaScript(body, arguments: [:], contentWorld: .page)',
    'webView.evaluateJavaScript("x")',
    'bridge?.eval(js: "x")',
    'bridge?.eval(js:"x")',
    'bridge?.triggerJSEvent(eventName: "x", target: "window")',
    'bridge?.triggerWindowJSEvent(eventName: "x")',
    'bridge?.triggerDocumentJSEvent(eventName: "x")',
    'notifyListeners("x", data: [:])',
    'let s = WKUserScript(source: "x", injectionTime: .atDocumentStart, forMainFrameOnly: true)',
  ]) {
    const path = 'packages/mobile-client/ios/App/App/Other.swift';
    const found = problems({ [path]: `import WebKit\n${line}\n` });
    assert.equal(found.length, 1, line);
    assert.match(found[0], /Other\.swift/);
  }
});

void test('Native Swift: allows the checked path and the allowlisted user script', () => {
  assert.deepEqual(
    problems({
      [CHECKED_PATH]:
        'try await callAsyncJavaScript(script, arguments: arguments, in: nil, contentWorld: .page)\n',
      [SCRIPT_ALLOWED]:
        'let script = WKUserScript(source: s, injectionTime: .atDocumentStart, forMainFrameOnly: true)\n',
    }),
    [],
  );
  // The allowlisted file may add a script, not call into the page
  assert.equal(
    problems({ [SCRIPT_ALLOWED]: 'webView.evaluateJavaScript("x")\n' }).length,
    1,
  );
});

void test('Native Swift: passes on bridge code', () => {
  assert.deepEqual(
    problems({
      'App/Ok.swift': 'import WebKit\nimport Capacitor\nimport SQLiteLike\n',
    }),
    [],
  );
});

// mac-app: "The web view is never weakened" (sc-4942)
void test('Native Swift: fails on file-URL access or a private WebKit setting', () => {
  for (const line of [
    'prefs.setValue(true, forKey: "allowFileAccessFromFileURLs")',
    'config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")',
    'webView.configuration.preferences.setValue(true, forKey: "_developerExtrasEnabled")',
    'webView.perform(NSSelectorFromString("_setDrawsBackground:"), with: false)',
    'let s = Selector(("_privateThing"))',
    // PR 413 review: each of these got past the first version of the rule
    'webView.loadFileURL(index, allowingReadAccessTo: URL(fileURLWithPath: "/"))',
    'prefs.setValue(true, forKey: "developerExtrasEnabled")',
    'prefs.setValue(true, forKeyPath: "_allowFileAccess")',
    'prefs.setValue(true, forKey: k)',
    'let k = "allow" + "FileAccessFromFileURLs"',
    'let c: AnyClass? = NSClassFromString("_WKProcessPoolConfiguration")',
    'let v = prefs.value(forKey: k)',
  ]) {
    const found = problems({
      'macos/Mac/Bad.swift': `import WebKit\n${line}\n`,
    });
    assert.equal(found.length, 1, line);
    assert.match(found[0], /macos\/Mac\/Bad\.swift: weakens WebKit/);
  }
  assert.deepEqual(
    problems({
      'macos/Mac/Ok.swift':
        'import WebKit\nconfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false\ndefaults.set(true, forKey: "budgetWasOpen")\nlet s = defaults.string(forKey: "cloudFileId")\n',
    }),
    [],
  );
});

void test('Native Swift: key-value coding is checked only where WebKit is imported', () => {
  assert.deepEqual(
    problems({
      'macos/Mac/Plain.swift':
        'import Foundation\nobject.setValue(1, forKey: "count")\n',
    }),
    [],
  );
});

// mac-app: "Swift never opens a budget file" (sc-4942 task 1.10)
void test('Native Swift: covers the Mac app sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-swift-'));
  const mac = join(root, 'packages/mobile-client/macos/HomeEconomicsMac');
  mkdirSync(mac, { recursive: true });
  writeFileSync(join(mac, 'Bad.swift'), 'import SQLite3\n');
  const found = problems(findNativeSources(root));
  assert.equal(found.length, 1);
  assert.match(
    found[0],
    /packages\/mobile-client\/macos\/HomeEconomicsMac\/Bad\.swift/,
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
