// Fork-only (sc-3584, ADR 11 data safety): Swift code never opens the budget
// database; only loot-core does. Fails when a Swift source under
// packages/mobile-client imports SQLite or GRDB, or names a .sqlite path.
// Run with `yarn check:native-swift`.
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

const RULES = [
  [
    /^\s*(?:@testable\s+)?import\s+(?:SQLite3|sqlite3|SQLite|GRDB)\b/m,
    'imports SQLite',
  ],
  [/\.sqlite\b/, 'names a .sqlite path'],
];

// files: { path: contents }. Returns failure messages; empty means pass.
export function problems(files) {
  return Object.entries(files).flatMap(([path, text]) =>
    RULES.filter(([re]) => re.test(text)).map(
      ([, what]) => `${path}: ${what}; only loot-core may open the budget`,
    ),
  );
}

export function findSwiftFiles(root) {
  const files = {};
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.swift')) {
        files[relative(root, path)] = readFileSync(path, 'utf8');
      }
    }
  };
  walk(join(root, SWIFT_ROOT));
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = problems(findSwiftFiles(process.cwd()));
  if (found.length) {
    console.error(`Native Swift check failed:\n  - ${found.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('Native Swift check passed.');
}
