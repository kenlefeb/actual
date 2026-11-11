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

// files: { path: contents }. Returns failure messages; empty means pass.
export function problems(files) {
  return Object.entries(files).flatMap(([path, text]) =>
    RULES.filter(([re]) => re.test(text)).map(
      ([, what]) => `${path}: ${what}; only loot-core may open the budget`,
    ),
  );
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
  if (found.length) {
    console.error(`Native Swift check failed:\n  - ${found.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('Native Swift check passed.');
}
