// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

const SCRIPT = new URL('./check-mac-release-flags.sh', import.meta.url)
  .pathname;

// Lines from the app target's real Release `xcodebuild -showBuildSettings`
// (2026-11-18): setting names that contain DEBUG, none of which define it
const CLEAN = `Build settings for action build and target HomeEconomicsMac:
    CONFIGURATION = Release
    DEBUGGING_SYMBOLS = YES
    DEBUG_INFORMATION_FORMAT = dwarf-with-dsym
    DEBUG_INFORMATION_VERSION = compiler-default
    ENABLE_DEBUG_DYLIB = YES
    MTL_ENABLE_DEBUG_INFO = NO
    RUNTIME_EXCEPTION_DEBUGGING_TOOL = NO
    SWIFT_OPTIMIZATION_LEVEL = -O
`;

function check(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'mac-release-flags-'));
  const file = join(dir, 'settings.txt');
  writeFileSync(file, settings);
  return spawnSync('sh', [SCRIPT, '--settings-file', file], {
    encoding: 'utf8',
  });
}

// story 5186: Release must never define DEBUG
void test('Mac Release flags: the real clean settings pass', () => {
  assert.equal(check(CLEAN).status, 0);
});

void test('Mac Release flags: every way to define DEBUG fails', () => {
  for (const line of [
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS = $(inherited) DEBUG',
    'GCC_PREPROCESSOR_DEFINITIONS = DEBUG=1',
    'GCC_PREPROCESSOR_DEFINITIONS = $(inherited) DEBUG=1',
    'OTHER_SWIFT_FLAGS = -DDEBUG',
    'OTHER_SWIFT_FLAGS = -D DEBUG',
    'OTHER_SWIFT_FLAGS = -Xfrontend -warn-long -DDEBUG',
  ]) {
    const result = check(`${CLEAN}    ${line}\n`);
    assert.equal(result.status, 1, line);
    assert.match(result.stderr, /defines DEBUG/, line);
  }
});

void test('Mac Release flags: other names that contain DEBUG pass', () => {
  for (const line of [
    'GCC_PREPROCESSOR_DEFINITIONS = NDEBUG=1',
    'OTHER_SWIFT_FLAGS = -DNDEBUG',
    'OTHER_SWIFT_FLAGS = -DDEBUG_MENU',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG_MENU',
  ]) {
    assert.equal(check(`${CLEAN}    ${line}\n`).status, 0, line);
  }
});
