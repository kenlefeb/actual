// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import {
  eventRoutingProblems,
  findNativeSources,
  missingFromProject,
  problems,
  storageGuardRolloutProblems,
  storageLineRolloutProblems,
} from './check-native-swift.mjs';

// native-durable-writes task 3.10 (D7a): one-way. The line on in Release
// requires the guard on; the guard may be on with the line off
void test('Native Swift: the storage line needs the guard, not the other way', () => {
  const line = on => `static let isOnInRelease = ${on}`;
  const guardOn = "send('native/enable-storage-guard')";
  assert.deepEqual(storageLineRolloutProblems(line('false'), 'no guard'), []);
  assert.deepEqual(storageLineRolloutProblems(line('true'), guardOn), []);
  assert.deepEqual(storageLineRolloutProblems(line('false'), guardOn), []);
  assert.match(
    storageLineRolloutProblems(line('true'), 'no guard')[0],
    /isOnInRelease/,
  );
  assert.match(
    storageLineRolloutProblems('renamed', 'no guard')[0],
    /not found/,
  );
});

// Design D7a: the iPhone's guard switch, its client and the bridge agree
void test('Native Swift: the guard switch, its client and the bridge agree', () => {
  const app = on =>
    `enum StorageGuardRollout {\n    static let isOn = ${on}\n}`;
  const plugin =
    'NativeBridgeClient(storage: s, storageGuardOn: StorageGuardRollout.isOn)\n' +
    'NativeShellScript.source(storageGuard: StorageGuardRollout.isOn, expectedOrigin: o)';
  const guardOn = "forward('native/enable-storage-guard')";
  // The page only learns the switch from the shell's script
  assert.match(
    storageGuardRolloutProblems(
      app('true'),
      'NativeBridgeClient(storage: s, storageGuardOn: StorageGuardRollout.isOn)\n' +
        'NativeShellScript.source(storageGuard: true, expectedOrigin: o)',
      guardOn,
    )[0],
    /NativeShellScript/,
  );
  assert.deepEqual(
    storageGuardRolloutProblems(app('false'), plugin, 'no guard'),
    [],
  );
  assert.deepEqual(
    storageGuardRolloutProblems(app('true'), plugin, guardOn),
    [],
  );
  assert.match(
    storageGuardRolloutProblems(app('true'), plugin, 'no guard')[0],
    /change together/,
  );
  assert.match(
    storageGuardRolloutProblems(app('false'), plugin, guardOn)[0],
    /change together/,
  );
  assert.match(
    storageGuardRolloutProblems(
      app('false'),
      'NativeBridgeClient(storage: s)',
      'no guard',
    )[0],
    /storageGuardOn/,
  );
  assert.match(
    storageGuardRolloutProblems('renamed', plugin, 'no guard')[0],
    /not found/,
  );
  // Security on PR #496: only the call counts, not a comment naming it
  for (const comment of [
    "// later: forward('native/enable-storage-guard')",
    "/* 'native/enable-storage-guard' */",
  ]) {
    assert.deepEqual(
      storageGuardRolloutProblems(app('false'), plugin, comment),
      [],
    );
    assert.match(
      storageGuardRolloutProblems(app('true'), plugin, comment)[0],
      /change together/,
    );
  }
});

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

// PR 413 re-review: other import forms, other private-API routes, and any
// file in the Mac app whatever it imports
void test('Native Swift: the Mac app gets the WebKit deny rule in every file', () => {
  const MAC = 'packages/mobile-client/macos/HomeEconomicsMac';
  for (const [file, text] of [
    [
      'A.swift',
      '@preconcurrency import WebKit\nprefs.setValue(true, forKey: "developerExtrasEnabled")\n',
    ],
    [
      'B.swift',
      'import class WebKit.WKPreferences\nprefs.setValue(true, forKey: k)\n',
    ],
    ['C.swift', 'import Foundation\nprefs.setValuesForKeys(["a": true])\n'],
    ['D.swift', 'import Darwin\nlet f = dlsym(handle, "WKThing")\n'],
    [
      'E.m',
      '#import <WebKit/WebKit.h>\n[prefs setValue:@YES forKey:@"developerExtrasEnabled"];\n',
    ],
    [
      'F.swift',
      'import Foundation\nfunc tweak(_ o: NSObject) { o.setValue(true, forKey: "x") }\n',
    ],
    ['G.m', 'id v = [prefs valueForKey:@"x"];\n'],
    ['H.swift', 'import ObjectiveC\nmethod_exchangeImplementations(a, b)\n'],
  ]) {
    const found = problems({ [`${MAC}/${file}`]: text });
    assert.equal(found.length, 1, file);
    assert.match(found[0], /weakens WebKit/, file);
  }
  assert.deepEqual(
    problems({
      [`${MAC}/Flag.swift`]:
        'import Foundation\ndefaults.set(true, forKey: "budgetWasOpen")\nlet id = defaults.string(forKey: "cloudFileId")\ndefaults.removeObject(forKey: "cloudFileId")\n',
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

// The App target lists its NativeBridgeCore sources one by one in the Xcode
// project, so a source added without an entry builds under `swift test` but
// breaks the iPhone app build (sc-4931).
// A project with an App target and a second target, each with its own Sources
// phase; `appSources` fill the App's, `otherSources` the other's.
function project({
  appSources = [],
  otherSources = [],
  extra = '',
  files = '',
}) {
  const list = names =>
    names.map((n, i) => `\t\t\t\tAA0${i} /* ${n} in Sources */,`).join('\n');
  return `/* Begin PBXBuildFile section */
${files}
/* End PBXBuildFile section */
/* Begin PBXNativeTarget section */
\t\tT1 /* App */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildPhases = (
\t\t\t\tP1 /* Sources */,
\t\t\t\tF1 /* Frameworks */,
\t\t\t);
\t\t\tname = App;
\t\t};
\t\tT2 /* AppTests */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildPhases = (
\t\t\t\tP2 /* Sources */,
\t\t\t);
\t\t\tname = AppTests;
\t\t};
/* End PBXNativeTarget section */
/* Begin PBXSourcesBuildPhase section */
\t\tP1 /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tfiles = (
${list(appSources)}
\t\t\t);
\t\t};
\t\tP2 /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tfiles = (
${list(otherSources)}
\t\t\t);
\t\t};
/* End PBXSourcesBuildPhase section */
${extra}`;
}

void test('Native Swift: names a NativeBridgeCore source missing from the Xcode project', () => {
  const p = project({ appSources: ['Reconcile.swift'] });
  assert.deepEqual(
    missingFromProject(['Reconcile.swift', 'Accounts.swift'], p),
    ['Accounts.swift'],
  );
  assert.deepEqual(missingFromProject(['Reconcile.swift'], p), []);
});

// sc-5023: the ways the old substring check passed when it should fail
void test('Native Swift: a build-file entry without a line in the App target`s Sources phase fails', () => {
  const p = project({
    files:
      '\t\tBF1 /* Accounts.swift in Sources */ = {isa = PBXBuildFile; fileRef = FR1 /* Accounts.swift */; };',
  });
  assert.deepEqual(missingFromProject(['Accounts.swift'], p), [
    'Accounts.swift',
  ]);
});

void test('Native Swift: a name only in a comment fails', () => {
  const p = project({
    appSources: ['Other.swift'],
    extra: '/* TODO: add Accounts.swift in Sources */\n',
  });
  assert.deepEqual(missingFromProject(['Accounts.swift'], p), [
    'Accounts.swift',
  ]);
});

void test('Native Swift: another file with the same ending does not count', () => {
  const p = project({ appSources: ['XAccounts.swift'] });
  assert.deepEqual(missingFromProject(['Accounts.swift'], p), [
    'Accounts.swift',
  ]);
});

void test('Native Swift: an entry in another target`s Sources phase does not count', () => {
  const p = project({ otherSources: ['Accounts.swift'] });
  assert.deepEqual(missingFromProject(['Accounts.swift'], p), [
    'Accounts.swift',
  ]);
});

void test('Native Swift: a project with no App target names every source', () => {
  assert.deepEqual(
    missingFromProject(['Accounts.swift'], '/* nothing here */'),
    ['Accounts.swift'],
  );
});

// sc-5504: the paycheck editor's UI-test host is held to the same rule
void test('Native Swift: the paycheck editor UI-test hook outside #if DEBUG fails', () => {
  const host = 'packages/mobile-client/ios/App/App/UITestPaycheckEditor.swift';
  assert.deepEqual(
    problems({ [host]: '#if DEBUG\nenum UITestPaycheckEditor {}\n#endif\n' }),
    [],
  );
  assert.match(
    problems({ [host]: 'enum UITestPaycheckEditor {}\n' })[0],
    /UITestPaycheckEditor\.swift: .*UI-test hook.*#if DEBUG/,
  );
  const scene = 'packages/mobile-client/ios/App/App/SceneDelegate.swift';
  assert.equal(
    problems({ [scene]: 'if UITestPaycheckEditor.isOn { run() }\n' }).length,
    1,
  );
  assert.deepEqual(
    problems({
      [scene]: '#if DEBUG\nif UITestPaycheckEditor.isOn { run() }\n#endif\n',
    }),
    [],
  );
});

// sc-5177: the UI-test hook (UITestAccounts) must not reach a Release build
void test('Native Swift: the UI-test hook outside #if DEBUG fails', () => {
  const host = 'packages/mobile-client/ios/App/App/UITestAccounts.swift';
  const guarded = '#if DEBUG\nenum UITestAccounts {}\n#endif\n';
  assert.deepEqual(problems({ [host]: guarded }), []);
  // The whole host unguarded
  assert.match(
    problems({ [host]: 'enum UITestAccounts {}\n' })[0],
    /UITestAccounts\.swift: .*UI-test hook.*#if DEBUG/,
  );
  // Closed too early: the type sits after the #endif
  assert.equal(
    problems({ [host]: '#if DEBUG\n#endif\nenum UITestAccounts {}\n' }).length,
    1,
  );
  // The switch in SceneDelegate
  const scene = 'packages/mobile-client/ios/App/App/SceneDelegate.swift';
  assert.deepEqual(
    problems({
      [scene]: '#if DEBUG\nif UITestAccounts.isOn { run() }\n#endif\n',
    }),
    [],
  );
  assert.equal(
    problems({ [scene]: 'if UITestAccounts.isOn { run() }\n' }).length,
    1,
  );
  // An #else of the DEBUG block is Release code
  assert.equal(
    problems({
      [scene]: '#if DEBUG\n#else\nif UITestAccounts.isOn { run() }\n#endif\n',
    }).length,
    1,
  );
  // A sibling host for another screen is held to the same rule
  assert.equal(
    problems({ [scene]: 'if UITestSettings.isOn { run() }\n' }).length,
    1,
  );
  assert.deepEqual(
    problems({
      [scene]: '#if DEBUG\nif UITestSettings.isOn { run() }\n#endif\n',
    }),
    [],
  );
  // A nested #if keeps the outer DEBUG; the UI-test target itself is not shipped
  assert.deepEqual(
    problems({
      [scene]:
        '#if DEBUG\n#if canImport(UIKit)\nUITestAccounts.isOn\n#endif\n#endif\n',
    }),
    [],
  );
  assert.deepEqual(
    problems({
      'packages/mobile-client/ios/App/AppUITests/NativeAccountsUITests.swift':
        'app.launchArguments = ["-UITestAccounts", "YES"]\n',
    }),
    [],
  );
});

// sc-5496 (native-budget-opened-signal D2): both shells send events through
// PageEventRouting.route, so budget-opened never reaches their change path
void test('Native Swift: both shells route events through PageEventRouting', () => {
  const routed = 'PageEventRouting.route(event, onBudgetOpened: x) { y() }';
  assert.deepEqual(eventRoutingProblems(routed, routed), []);
  assert.match(
    eventRoutingProblems('onEvent?(event)', routed)[0],
    /NativeBridgePlugin/,
  );
  assert.match(
    eventRoutingProblems(routed, '// PageEventRouting.route( in a comment')[0],
    /MacEngineHost/,
  );
});
