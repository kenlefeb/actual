// Fork-only (sc-632): lists every `#### Scenario:` in openspec/specs/ that no
// test names. A scenario counts as tested when its exact name appears in a
// test file, which is how tests title themselves ("Name" or "Name: detail").
// Report only: it always exits 0. Run with `yarn check:spec-scenarios`.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseScenarios(specText) {
  return [...specText.matchAll(/^#### Scenario:(.*)$/gm)].map(([, name]) =>
    name.trim(),
  );
}

// specs: Map of spec name to its scenario names; tests: test file contents
export function untested(specs, tests) {
  const missing = [];
  for (const [spec, scenarios] of specs) {
    for (const scenario of scenarios) {
      if (!tests.some(text => text.includes(scenario))) {
        missing.push({ spec, scenario });
      }
    }
  }
  return missing;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const specsDir = join(root, 'openspec/specs');
  const specs = new Map(
    readdirSync(specsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(({ name }) => [
        name,
        parseScenarios(readFileSync(join(specsDir, name, 'spec.md'), 'utf8')),
      ]),
  );
  // Tracked test files only, so node_modules and build output never count
  const testFiles = execFileSync(
    'git',
    ['ls-files', '-z', '--', '*.test.*', '*.spec.*'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const tests = testFiles.map(file => readFileSync(join(root, file), 'utf8'));

  const missing = untested(specs, tests);
  const total = [...specs.values()].reduce((n, s) => n + s.length, 0);
  let current;
  for (const { spec, scenario } of missing) {
    if (spec !== current) {
      console.log(`\n${spec}`);
      current = spec;
    }
    console.log(`  - ${scenario}`);
  }
  console.log(
    `\n${missing.length} of ${total} scenarios have no test that names them.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
