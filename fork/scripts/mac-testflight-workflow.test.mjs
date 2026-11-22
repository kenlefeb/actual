// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
// sc-4953: the contract of the Mac TestFlight workflow, read as text so a
// change that opens a trigger, leaks a secret or drops a gate fails Fork CI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

const read = path =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const WORKFLOW = read('.github/workflows/fork-mac-native-testflight.yml');
const OPTIONS = read('packages/mobile-client/macos/ExportOptions.plist');
const HOLD = JSON.parse(read('fork/mac-testflight.json'));
// Workflow text without comment lines, so a comment never satisfies or breaks a check
const CODE = WORKFLOW.split('\n')
  .filter(l => !/^\s*#/.test(l))
  .join('\n');

void test('Mac TestFlight: only a manual dispatch starts it', () => {
  assert.match(CODE, /^on:\n {2}workflow_dispatch:/m);
  for (const trigger of ['push', 'pull_request', 'schedule', 'workflow_run']) {
    assert.doesNotMatch(CODE, new RegExp(`^ {2}${trigger}:`, 'm'), trigger);
  }
});

void test('Mac TestFlight: runs only in the fork, from the development branch', () => {
  assert.match(CODE, /github\.repository == 'kenlefeb\/actual'/);
  assert.match(CODE, /refs\/heads\/development/);
});

void test('Mac TestFlight: the hold switch and the Fork CI result gate the upload', () => {
  assert.equal(typeof HOLD.held, 'boolean');
  assert.match(CODE, /fork\/mac-testflight\.json/);
  assert.match(CODE, /fork-ci\.yml/);
  assert.match(CODE, /testflight:\n(?: {4}.*\n)*? {4}needs: gate/);
});

void test('Mac TestFlight: builds the Mac app under its own bundle id, never the Electron one', () => {
  assert.match(CODE, /BUNDLE_ID: app\.homeeconomics\.budget\.mac\n/);
  assert.doesNotMatch(CODE, /app\.homeeconomics\.budget(?!\.mac)/);
  assert.match(CODE, /-project HomeEconomicsMac\.xcodeproj/);
  assert.match(CODE, /-destination generic\/platform=macOS/);
  assert.match(CODE, /-configuration Release/);
  assert.match(CODE, /--platform MAC_OS/);
  // An unsigned Mac archive holds no entitlements, so no sandbox in the export
  assert.match(CODE, /CODE_SIGN_IDENTITY=- archive/);
  assert.doesNotMatch(CODE, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(CODE, /check-mac-release-flags\.sh/);
});

void test('Mac TestFlight: exports for App Store Connect, internal testers only', () => {
  assert.match(
    OPTIONS,
    /<key>method<\/key>\s*<string>app-store-connect<\/string>/,
  );
  assert.match(
    OPTIONS,
    /<key>signingStyle<\/key>\s*<string>automatic<\/string>/,
  );
  assert.match(OPTIONS, /<key>testFlightInternalTestingOnly<\/key>\s*<true\/>/);
  assert.match(
    OPTIONS,
    /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/,
  );
  assert.match(
    CODE,
    /cp ExportOptions\.plist "\$RUNNER_TEMP\/ExportOptions\.plist"/,
  );
});

void test('Mac TestFlight: secrets reach steps only as env values and are never echoed', () => {
  for (const line of CODE.split('\n').filter(l => l.includes('secrets.'))) {
    assert.match(
      line,
      /^\s+[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/,
      line,
    );
  }
  assert.doesNotMatch(CODE, /set -x|xtrace/);
  // The key may only be piped into the PEM normalizer
  assert.doesNotMatch(
    CODE,
    /(echo|printf)[^\n|>]*\$\{?API_KEY_P8\}?"?(?!"?\s*\| node )/,
  );
  assert.match(
    CODE,
    /if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/AuthKey\.p8"/,
  );
});

void test('Mac TestFlight: checks the signed package before anything is uploaded', () => {
  const check = CODE.indexOf('pkgutil --check-signature');
  const entitlements = CODE.indexOf('com.apple.security.app-sandbox', check);
  const upload = CODE.indexOf('app-store-connect publish');
  assert.ok(check > 0 && entitlements > check && upload > entitlements);
});

void test('Mac TestFlight: every action is pinned to a commit', () => {
  for (const line of CODE.split('\n').filter(l => /uses: [^.]/.test(l))) {
    assert.match(line, /uses: [\w./-]+@[0-9a-f]{40}/, line);
  }
});
