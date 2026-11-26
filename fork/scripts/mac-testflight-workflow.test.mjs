// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
// sc-4953: the contract of the Mac TestFlight workflow, read as text so a
// change that opens a trigger, leaks a secret or drops a gate fails Fork CI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// Security review of PR 523: `revision` must not let an unreviewed commit, or an
// older commit that was not held, reach TestFlight.
const GATE = CODE.slice(
  CODE.indexOf('\n  gate:'),
  CODE.indexOf('\n  testflight:'),
);

void test('Mac TestFlight gate: the revision is a full commit SHA', () => {
  assert.match(GATE, /\^\[0-9a-f\]\{40\}\$/);
});

void test('Mac TestFlight gate: a multi-line revision cannot pass', () => {
  // Security review of PR 524: grep checks each line on its own, so a value
  // with a newline passed; match the whole string and match it as a fixed string
  assert.match(GATE, /\[\[ "\$REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.doesNotMatch(GATE, /echo "\$REVISION" \| grep/);
  assert.match(GATE, /grep -Fqx -- "\$REVISION"/);
  const sha = 'a'.repeat(40);
  const check = `[[ "$1" =~ ^[0-9a-f]{40}$ ]]`;
  const run = value => spawnSync('bash', ['-c', check, 'bash', value]).status;
  assert.equal(run(sha), 0);
  assert.notEqual(run(`${sha}\n${sha}`), 0);
  assert.notEqual(run(`${sha}\nnot-a-sha`), 0);
});

void test('Mac TestFlight gate: the revision must be a first-parent commit of development', () => {
  // sc-5636: an intermediate commit of a merged PR is an ancestor too, so only
  // landing points on development's first-parent line may be built
  assert.match(
    GATE,
    /git rev-list --first-parent origin\/development \| grep -Fqx -- "\$REVISION"/,
  );
  assert.doesNotMatch(GATE, /--is-ancestor/);
  // Needs development's history, not just the revision
  assert.match(GATE, /fetch-depth: 0/);
  assert.doesNotMatch(GATE, /ref: \$\{\{ inputs\.revision/);
});

void test('Mac TestFlight gate: the hold switch is read from the head of development', () => {
  assert.match(GATE, /git show origin\/development:fork\/mac-testflight\.json/);
  assert.doesNotMatch(GATE, /jq [^\n]*fork\/mac-testflight\.json/);
});

void test('Mac TestFlight: a failing what-to-test script stops the step', () => {
  assert.match(
    CODE,
    /\n\s+WHATS_NEW="\$\(node fork\/scripts\/mac-whats-new\.mjs "\$VERSION" "\$COMMIT"\)"\n/,
  );
  assert.doesNotMatch(CODE, /--whats-new "\$\(/);
});

void test('Mac TestFlight: the archive carries the mapped Apple version', () => {
  assert.match(CODE, /marketing=\$\(node fork\/scripts\/apple-version\.mjs /);
  assert.match(
    CODE,
    /MARKETING_VERSION: \$\{\{ steps\.version\.outputs\.marketing \}\}/,
  );
});

// Run 45748941146: Apple rejected the first upload (ITMS-90255, ITMS-90236)
void test('Mac TestFlight: the private umask covers only the API key', () => {
  const umasks = CODE.split('\n').filter(l => l.includes('umask'));
  assert.equal(umasks.length, 1);
  // A subshell, so xcodebuild's package keeps world-readable files
  assert.match(
    umasks[0],
    /^\s+\(umask 077 && printf .*\| node .*> "\$RUNNER_TEMP\/AuthKey\.p8"\)$/,
  );
});

void test('Mac TestFlight: a package file that is not world-readable fails before upload', () => {
  const program = CODE.match(/awk -F'\\t' '([^']+)'/)?.[1];
  assert.ok(program, 'no awk permission check');
  assert.match(CODE, /BOMS="\$\(find expanded -name Bom\)"/);
  assert.match(CODE, /test -n "\$BOMS"/);
  assert.match(CODE, /LIST="\$\(lsbom -p mf "\$BOM"\)"/);
  assert.ok(CODE.indexOf('lsbom') < CODE.indexOf('app-store-connect publish'));
  // Run the workflow's own program on `lsbom -p mf` lines (mode, path)
  const run = lines =>
    spawnSync('awk', ['-F', '\t', program], {
      input: `${lines.join('\n')}\n`,
    }).status;
  const good = ['40755\t.', '100644\t./a b', '100755\t./x', '120755\t./l'];
  assert.equal(run(good), 0);
  assert.equal(run([...good, '104755\t./s', '41755\t./t']), 0);
  for (const bad of [
    '100600\t./f',
    '100640\t./f',
    '40700\t./d',
    '40754\t./d',
    '104750\t./s',
    '102700\t./g',
    '41750\t./t',
    '42700\t./g',
  ]) {
    assert.notEqual(run([...good, bad]), 0, bad);
  }
});

void test('Mac TestFlight: an empty Bom listing fails the package check', () => {
  // lsbom exits 0 and prints nothing for a corrupt or missing Bom
  const loop = CODE.match(
    /^ +while IFS= read -r BOM; do\n[\s\S]*?<<< "\$BOMS"$/m,
  );
  assert.ok(loop, 'no Bom loop');
  const run = listing =>
    spawnSync(
      'bash',
      ['-ec', `lsbom() { printf '%s' "$LISTING"; }\nBOMS=x\n${loop[0]}`],
      { env: { ...process.env, LISTING: listing }, encoding: 'utf8' },
    );
  assert.equal(run('100644\t./f').status, 0);
  const empty = run('');
  assert.notEqual(empty.status, 0);
  assert.match(empty.stdout, /::error::/);
});

void test('Mac app: the Release build names an icon with every macOS size', () => {
  const project = read('packages/mobile-client/macos/project.yml');
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon\n/);
  // Without it the built AppIcon.icns has no 1024px image
  assert.match(
    project,
    /ASSETCATALOG_COMPILER_STANDALONE_ICON_BEHAVIOR: all\n/,
  );
  const dir =
    'packages/mobile-client/macos/HomeEconomicsMac/Assets.xcassets/AppIcon.appiconset';
  const { images } = JSON.parse(read(`${dir}/Contents.json`));
  assert.equal(images.length, 10);
  for (const { filename, size, scale } of images) {
    const png = readFileSync(
      new URL(`../../${dir}/${filename}`, import.meta.url),
    );
    // Width and height in the PNG header
    const pixels = parseInt(size, 10) * parseInt(scale, 10);
    assert.equal(png.readUInt32BE(16), pixels, filename);
    assert.equal(png.readUInt32BE(20), pixels, filename);
  }
});
