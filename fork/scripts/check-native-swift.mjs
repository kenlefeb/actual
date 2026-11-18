// Fork-only (sc-3584, ADR 11 data safety): native code never opens the budget
// database; only loot-core does. Fails when a Swift, header or Objective-C
// source under packages/mobile-client imports or checks for a database
// library, includes sqlite3.h, or names a .sqlite path.
// shortcut: regexes, not a parser; they guard against accidents, not a
// determined author. Run with `yarn check:native-swift`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SWIFT_ROOT = 'packages/mobile-client';
// Generated or vendored code, not ours
const SKIP = new Set([
  'node_modules',
  'Pods',
  '.build',
  'DerivedData',
  'build',
]);

const DATABASE = 'SQLite3|sqlite3|SQLite|CSQLite|SQLCipher|GRDB|FMDB|CoreData';
const SOURCE = /\.(swift|h|m|mm)$/;

const RULES = [
  [
    new RegExp(
      `^\\s*(?:@testable\\s+)?import\\s+(?:(?:struct|class|enum|func|var|let|typealias|protocol)\\s+)?(?:${DATABASE})\\b`,
      'm',
    ),
    'imports a database library',
  ],
  [
    new RegExp(`canImport\\(\\s*(?:${DATABASE})\\s*\\)`),
    'checks for a database library',
  ],
  [/^\s*#\s*(?:import|include)\s*[<"]sqlite3\.h[>"]/m, 'includes sqlite3.h'],
  [/\.sqlite3?\b/, 'names a .sqlite path'],
];

// sc-3859: every Swift call into the page goes through PageCall, which checks
// the page's origin first; user scripts are added only where they are gated
// on that origin.
const CHECKED_PATH =
  'packages/mobile-client/ios/NativeBridge/Sources/NativeBridgeCore/PageOriginGuard.swift';
const USER_SCRIPT_ALLOWED = new Set([
  'packages/mobile-client/ios/App/App/NativeChromePlugin.swift',
]);
const PAGE_CALL =
  /\b(?:callAsyncJavaScript|evaluateJavaScript|triggerJSEvent|triggerWindowJSEvent|triggerDocumentJSEvent|notifyListeners)\b|\beval\(\s*js\s*:/;
const USER_SCRIPT = /\bWKUserScript\s*\(/;
// sc-4942 (mac-app): no file-URL access and no private WebKit API. The
// setting names fail anywhere; in a file that imports WebKit, the ways to
// reach a private API (key-value coding, selectors and classes by name) and
// file-URL loading fail outright, whatever the key. UserDefaults'
// `set(_:forKey:)` and `string(forKey:)` stay allowed.
const FILE_URL_SETTING =
  /(?:FileAccessFromFileURLs|UniversalAccessFromFileURLs)/;
// Any attributes, and `import class WebKit.X`; Objective-C's #import too
const IMPORTS_WEBKIT =
  /^\s*(?:@\w+\s+)*import\s+(?:(?:struct|class|enum|func|var|let|typealias|protocol)\s+)?WebKit\b|^\s*#\s*import\s*<WebKit\//m;
const WEBKIT_DENIED =
  /\bloadFileURL\b|\.setValue\(|\bsetValuesForKeys\b|\bvalue\(\s*forKey|forKeyPath:|\bsetValue:|\bvalueForKey:|\bNSClassFromString\b|\bNSSelectorFromString\b|\bSelector\(\s*\(|\bdlsym\b|\bobjc_msgSend\b|\bclass_getInstanceMethod\b|\bmethod_exchangeImplementations\b/;
// The Mac app has no legitimate key-value coding, so every file there is
// checked, whatever it imports (PR 413 re-review)
const MAC_ROOT = 'packages/mobile-client/macos/';

function weakensWebKit(path, text) {
  return (
    FILE_URL_SETTING.test(text) ||
    ((path.startsWith(MAC_ROOT) || IMPORTS_WEBKIT.test(text)) &&
      WEBKIT_DENIED.test(text))
  );
}

// files: { path: contents }. Returns failure messages; empty means pass.
export function problems(files) {
  return Object.entries(files).flatMap(([path, text]) => [
    ...RULES.filter(([re]) => re.test(text)).map(
      ([, what]) => `${path}: ${what}; only loot-core may open the budget`,
    ),
    ...(path !== CHECKED_PATH && PAGE_CALL.test(text)
      ? [
          `${path}: calls into the page outside PageCall (PageOriginGuard.swift)`,
        ]
      : []),
    ...(!USER_SCRIPT_ALLOWED.has(path) && USER_SCRIPT.test(text)
      ? [`${path}: adds a WKUserScript outside the allowlist`]
      : []),
    ...(weakensWebKit(path, text)
      ? [
          `${path}: weakens WebKit (file-URL access or a private API); see add-mac-app-shell`,
        ]
      : []),
  ]);
}

// The App target compiles NativeBridgeCore from the Xcode project's own list of
// files, so `swift test` passes on a source the iPhone build never sees.
// names: the sources' file names; project: the project.pbxproj text. A name
// counts only as an entry in the App target's own Sources build phase (sc-5023):
// not a file reference, a comment, another target, or a name with the same ending.
function appSourceEntries(project) {
  const target = /isa = PBXNativeTarget;(?:(?!isa = PBX)[^]*?)name = App;/.exec(
    project,
  );
  const phaseId = target && /(\w+) \/\* Sources \*\//.exec(target[0])?.[1];
  const phase =
    phaseId &&
    new RegExp(
      `^\\s*${phaseId} /\\* Sources \\*/ = \\{\\s*isa = PBXSourcesBuildPhase;[^]*?files = \\(([^)]*)\\);`,
      'm',
    ).exec(project);
  return new Set(
    [
      ...(phase?.[1] ?? '').matchAll(
        /^\s*\w+ \/\* (.+) in Sources \*\/,\s*$/gm,
      ),
    ].map(m => m[1]),
  );
}

export function missingFromProject(names, project) {
  const entries = appSourceEntries(project);
  return names.filter(name => !entries.has(name));
}

export function findNativeSources(root) {
  const files = {};
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (SOURCE.test(entry.name)) {
        files[relative(root, path)] = readFileSync(path, 'utf8');
      }
    }
  };
  walk(join(root, SWIFT_ROOT));
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = problems(findNativeSources(process.cwd()));
  const core = join(SWIFT_ROOT, 'ios/NativeBridge/Sources/NativeBridgeCore');
  const project = readFileSync(
    join(SWIFT_ROOT, 'ios/App/App.xcodeproj/project.pbxproj'),
    'utf8',
  );
  for (const name of missingFromProject(
    readdirSync(core).filter(file => file.endsWith('.swift')),
    project,
  )) {
    found.push(
      `${join(core, name)}: not in the Xcode project's Sources, so the iPhone app build cannot see it`,
    );
  }
  if (found.length) {
    console.error(`Native Swift check failed:\n  - ${found.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('Native Swift check passed.');
}
