// Fork-only (sc-1570): every server handler and every @actual-app/api export
// must be mapped in packages/mcp/coverage.json to an MCP tool or to a skip
// with a reason. Names already in packages/mcp/upstream-handlers.json
// (generated from upstream/master) need no entry. Run with
// `yarn check:mcp-coverage`. To refresh the baseline after an upstream merge:
// `node fork/scripts/check-mcp-coverage.mjs --baseline-from upstream/master`.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = 'packages/loot-core/src/server';
const METHODS = 'packages/api/methods.ts';
const BASELINE = 'packages/mcp/upstream-handlers.json';
const isSource = f => /\.(ts|tsx|js)$/.test(f) && !/\.test\./.test(f);
const captures = (text, re) => [...text.matchAll(re)].map(m => m[1]);

// shortcut: regex, not a parser; a `//` inside a string (not after `:`, so
// URLs survive) would cut that line. Upgrade if a scanned file needs it.
const stripComments = text =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

// Matches whole text, so a registration split over lines is found
export const findHandlers = text =>
  captures(stripComments(text), /\bapp\.method\(\s*['"`]([^'"`]+)['"`]/g);

export function findApiExports(text) {
  const out = captures(
    text,
    /^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm,
  );
  for (const list of captures(text, /^export\s*\{([^}]*)\}/gm)) {
    for (const item of list.split(',')) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) out.push(name);
    }
  }
  return out;
}

export const findTools = text =>
  captures(
    stripComments(text),
    /\b(?:registerTool|tool)\(\s*['"]([a-z_]+)['"]/g,
  );

// Returns failure messages; an empty list means the check passes
export function problems({
  handlers,
  exports,
  baseline,
  manifest,
  tools,
  testText: rawTestText,
  methodsText: rawMethodsText,
}) {
  const out = [];
  const testText = stripComments(rawTestText);
  const methodsText = stripComments(rawMethodsText);
  const forkHandlers = handlers.filter(n => !baseline.handlers.includes(n));
  const forkExports = exports.filter(n => !baseline.apiExports.includes(n));

  for (const name of [...forkHandlers, ...forkExports]) {
    if (!(name in manifest)) {
      out.push(
        `${name}: no entry in coverage.json (map it to a tool or add a skip with a reason)`,
      );
    }
  }
  for (const [name, entry] of Object.entries(manifest)) {
    const hasTool = typeof entry.tool === 'string';
    const hasSkip = 'skip' in entry;
    if (hasTool === hasSkip) {
      out.push(`${name}: entry needs exactly one of "tool" or "skip"`);
    } else if (
      hasSkip &&
      !(typeof entry.skip === 'string' && entry.skip.trim())
    ) {
      out.push(`${name}: skip needs a reason`);
    } else if (hasTool && !tools.includes(entry.tool)) {
      out.push(`${name}: tool ${entry.tool} is not registered`);
    } else if (
      hasTool &&
      !testText.includes(`'${entry.tool}'`) &&
      !testText.includes(`"${entry.tool}"`)
    ) {
      out.push(`${name}: tool ${entry.tool} has no test naming it`);
    }
  }
  for (const name of forkHandlers) {
    const reason = manifest[name]?.skip;
    if (
      !(typeof reason === 'string' && reason.trim()) &&
      !methodsText.includes(`send('${name}'`)
    ) {
      out.push(`${name}: no send('${name}' in ${METHODS} and no skip reason`);
    }
  }
  return out;
}

const walk = (dir, root) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel, root);
    return /\.(ts|tsx|js)$/.test(e.name) ? [rel] : [];
  });

const scanHandlers = (read, files) =>
  [...new Set(files.flatMap(f => findHandlers(read(f))))].sort((a, b) =>
    a.localeCompare(b),
  );

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  const read = f => readFileSync(join(root, f), 'utf8');

  const refIdx = process.argv.indexOf('--baseline-from');
  if (refIdx > 0) {
    const ref = process.argv[refIdx + 1];
    const files = git('ls-tree', '-r', '--name-only', ref, '--', SERVER_DIR)
      .split('\n')
      .filter(isSource);
    const baseline = {
      ref,
      commit: git('rev-parse', ref).trim(),
      handlers: scanHandlers(f => git('show', `${ref}:${f}`), files),
      apiExports: [
        ...new Set(findApiExports(git('show', `${ref}:${METHODS}`))),
      ].sort((a, b) => a.localeCompare(b)),
    };
    writeFileSync(
      join(root, BASELINE),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log(
      `Baseline from ${ref}: ${baseline.handlers.length} handlers, ${baseline.apiExports.length} API exports.`,
    );
    return;
  }

  const methodsText = read(METHODS);
  const mcpSrc = walk('packages/mcp/src', root);
  const failures = problems({
    handlers: scanHandlers(read, walk(SERVER_DIR, root).filter(isSource)),
    exports: findApiExports(methodsText),
    baseline: JSON.parse(read(BASELINE)),
    manifest: JSON.parse(read('packages/mcp/coverage.json')),
    tools: mcpSrc.filter(isSource).flatMap(f => findTools(read(f))),
    testText: mcpSrc
      .filter(f => f.includes('.test.'))
      .map(read)
      .join('\n'),
    methodsText,
  });
  if (failures.length) {
    console.error(
      `MCP coverage check failed:\n${failures.map(f => `  - ${f}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('MCP coverage check passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
