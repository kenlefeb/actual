// Fork-only (sc-5219, openspec/changes/native-durable-writes D10). Test hooks
// that weaken storage durability sit behind the __FORK_TEST_HOOKS__ build
// constant. Fails when a production web build's page or worker bundle still
// holds a hook's marker. Run after `yarn build:browser`.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_MARKERS = [
  '__forkTestCommitDelayMs',
  '__forkTestBarrierOff',
  '__FORK_TEST_COMMIT_DELAY_MS__',
];

const DEFAULT_BUILD = 'packages/desktop-client/build';

export function findTestHooks(buildDir) {
  const bundles = readdirSync(buildDir, { recursive: true })
    .map(String)
    .filter(file => file.endsWith('.js'));
  const problems = [];
  // Without the worker the check would pass having looked at nothing
  if (!bundles.some(file => /^kcab\.worker\..*\.js$/.test(basename(file)))) {
    problems.push(`no worker bundle found under ${buildDir}`);
  }
  for (const file of bundles) {
    const text = readFileSync(join(buildDir, file), 'utf8');
    for (const marker of HOOK_MARKERS) {
      if (text.includes(marker)) problems.push(`${file} contains ${marker}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = findTestHooks(process.argv[2] ?? DEFAULT_BUILD);
  if (problems.length > 0) {
    console.error(
      `Test hooks in the production build:\n${problems.map(p => `  - ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('No test hooks in the production build.');
}
