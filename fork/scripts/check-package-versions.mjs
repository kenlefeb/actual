// Fork-only (sc-1573): the eight release packages must share one version
// (AGENTS.md, "Private customized build versions"). Run with
// `yarn check:package-versions`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directory under packages/ for each release package, in the order AGENTS.md lists them.
const DIRS = [
  'desktop-client',
  'desktop-electron',
  'sync-server',
  'api',
  'cli',
  'loot-core',
  'mobile-client',
  'mcp',
];

export const PACKAGES = [
  '@actual-app/web',
  'desktop-electron',
  '@actual-app/sync-server',
  '@actual-app/api',
  '@actual-app/cli',
  '@actual-app/core',
  'mobile-client',
  '@actual-app/mcp',
];

// Map of package name to version.
export function readVersions(root, read = p => readFileSync(p, 'utf8')) {
  return Object.fromEntries(
    DIRS.map(dir => {
      const { name, version } = JSON.parse(
        read(join(root, 'packages', dir, 'package.json')),
      );
      return [name, version];
    }),
  );
}

// One message per package whose version differs from the most common one.
export function findDrift(versions) {
  const counts = new Map();
  for (const v of Object.values(versions)) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const [expected] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return Object.entries(versions)
    .filter(([, v]) => v !== expected)
    .map(([name, v]) => `${name} is ${v}, the others are ${expected}`);
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const versions = readVersions(root);
  const drift = findDrift(versions);
  if (drift.length) {
    console.error(
      `Package versions differ:\n${drift.map(d => `  - ${d}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(
    `All ${DIRS.length} release packages are at ${Object.values(versions)[0]}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
