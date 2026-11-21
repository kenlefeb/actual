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

// sc-5177: the iPhone UI tests launch the app on fixtures through a hook
// (UITestAccounts; sc-5504 adds UITestPaycheckEditor, caught by the same
// UITest* pattern). Every line that names it must sit inside `#if DEBUG`, so a
// Release build, which TestFlight ships, has neither the hook nor its launch
// argument. The UI-test target itself is never part of the app.
// shortcut: counts #if/#endif lines, not a parser; an `#if DEBUG && x` or a
// negated condition is not recognised as Debug-only, which can only fail loudly.
const UI_TEST_HOOK = /UITest[A-Z]\w*/;

function hookOutsideDebug(path, text) {
  if (path.includes('/AppUITests/')) return [];
  // One entry per open #if: true while the branch is the Debug-only one
  const open = [];
  const outside = [];
  text.split('\n').forEach((line, i) => {
    const directive = /^\s*#(if|elseif|else|endif)\b(.*)/.exec(line);
    if (directive) {
      const [, kind, rest] = directive;
      if (kind === 'if') open.push(rest.trim() === 'DEBUG');
      else if (kind === 'endif') open.pop();
      else open[open.length - 1] = false;
    } else if (UI_TEST_HOOK.test(line) && !open.some(Boolean)) {
      outside.push(i + 1);
    }
  });
  return outside.length
    ? [
        `${path}: names the UI-test hook outside #if DEBUG (line ${outside[0]}); a Release build must not contain it`,
      ]
    : [];
}

// files: { path: contents }. Returns failure messages; empty means pass.
export function problems(files) {
  return Object.entries(files).flatMap(([path, text]) => [
    ...hookOutsideDebug(path, text),
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

// native-durable-writes task 3.10: the storage line stays out of Release until
// the PR that also turns on the storage guard and adds the notices. The page
// bridge's call to the guard's switch is what says that PR has happened.
// The bridge turns the guard on only by calling it; a comment naming it doesn't count
function callsStorageGuard(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return code.includes("'native/enable-storage-guard'");
}

// One-way (D7a): the line on in Release requires the guard on; the guard may
// be on with the line off, as it is from the iPhone's guard flip until task 6.6
export function storageLineRolloutProblems(tabBarSource, bridgeSource) {
  const flag = /\bisOnInRelease\s*=\s*(true|false)\b/.exec(tabBarSource)?.[1];
  if (!flag) return ['WriteStorageLineRollout.isOnInRelease: not found'];
  return flag === 'true' && !callsStorageGuard(bridgeSource)
    ? [
        'WriteStorageLineRollout.isOnInRelease is true but the page bridge does not turn the storage guard on; the line needs the guard',
      ]
    : [];
}

// Design D7a: the opened write API follows the iPhone's switch, the page learns
// the switch from the shell's script, and the switch agrees with the bridge
// turning the guard on, so none changes without the others. `pluginSource` is
// the iPhone's bridge and chrome plugins together.
export function storageGuardRolloutProblems(
  appSource,
  pluginSource,
  bridgeSource,
) {
  const flag =
    /enum StorageGuardRollout \{\s*static let isOn = (true|false)\b/.exec(
      appSource,
    )?.[1];
  if (!flag) return ['StorageGuardRollout.isOn: not found'];
  const found = [];
  if (!pluginSource.includes('storageGuardOn: StorageGuardRollout.isOn')) {
    found.push(
      "NativeBridgePlugin's client must take storageGuardOn from StorageGuardRollout.isOn",
    );
  }
  if (
    !pluginSource.includes(
      'NativeShellScript.source(storageGuard: StorageGuardRollout.isOn',
    )
  ) {
    found.push(
      "The page must learn the switch from NativeShellScript.source(storageGuard: StorageGuardRollout.isOn, …) in the iPhone's plugins",
    );
  }
  const guardIsOn = callsStorageGuard(bridgeSource);
  if ((flag === 'true') !== guardIsOn) {
    found.push(
      `StorageGuardRollout.isOn is ${flag} but the page bridge ${guardIsOn ? 'turns' : 'does not turn'} the storage guard on; they change together`,
    );
  }
  return found;
}

// sc-5496 (native-budget-opened-signal D2): both shells hand every page event to
// PageEventRouting.route, which keeps `budget-opened` off the change path. A
// shell that fans events out itself would re-read a loaded Budget screen.
export function eventRoutingProblems(pluginSource, hostSource) {
  const calls = source =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .includes('PageEventRouting.route(');
  return [
    ['NativeBridgePlugin', pluginSource],
    ['MacEngineHost', hostSource],
  ]
    .filter(([, source]) => !calls(source))
    .map(
      ([name]) =>
        `${name} must send page events through PageEventRouting.route`,
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
  found.push(
    ...eventRoutingProblems(
      readFileSync(
        join(SWIFT_ROOT, 'ios/App/App/NativeBridgePlugin.swift'),
        'utf8',
      ),
      readFileSync(
        join(SWIFT_ROOT, 'macos/HomeEconomicsMac/MacEngineHost.swift'),
        'utf8',
      ),
    ),
  );
  found.push(
    ...storageGuardRolloutProblems(
      readFileSync(
        join(SWIFT_ROOT, 'ios/App/App/AppBridgeViewController.swift'),
        'utf8',
      ),
      readFileSync(
        join(SWIFT_ROOT, 'ios/App/App/NativeBridgePlugin.swift'),
        'utf8',
      ) +
        readFileSync(
          join(SWIFT_ROOT, 'ios/App/App/NativeChromePlugin.swift'),
          'utf8',
        ),
      readFileSync(
        'packages/desktop-client/src/native/nativeBridge.ts',
        'utf8',
      ),
    ),
    ...storageLineRolloutProblems(
      readFileSync(
        join(SWIFT_ROOT, 'ios/App/App/NativeTabBarController.swift'),
        'utf8',
      ),
      readFileSync(
        'packages/desktop-client/src/native/nativeBridge.ts',
        'utf8',
      ),
    ),
  );
  if (found.length) {
    console.error(`Native Swift check failed:\n  - ${found.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('Native Swift check passed.');
}
