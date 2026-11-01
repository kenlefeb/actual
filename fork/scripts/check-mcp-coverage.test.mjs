// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import {
  findApiExports,
  findHandlers,
  findTools,
  problems,
} from './check-mcp-coverage.mjs';

// A world that fails only for the fork handler `paycheck-foo` having no entry
function world(over = {}) {
  return {
    handlers: ['old-one', 'paycheck-foo'],
    exports: [],
    baseline: { handlers: ['old-one'], apiExports: [] },
    manifest: {},
    tools: [],
    testText: '',
    methodsText: "send('paycheck-foo', args)",
    ...over,
  };
}

void test('A new handler without coverage: fails and names the handler', () => {
  const out = problems(world());
  assert.equal(out.length, 1);
  assert.match(out[0], /paycheck-foo/);
});

void test('A deliberate skip: passes', () => {
  const out = problems(
    world({ manifest: { 'paycheck-foo': { skip: 'UI only' } } }),
  );
  assert.deepEqual(out, []);
});

void test('A registration across lines: finds the handler', () => {
  const text = `app.method(\n  'account-set-business-days',\n  mutator(async () => {}),\n);\napp.method('one-line', x);`;
  assert.deepEqual(findHandlers(text), [
    'account-set-business-days',
    'one-line',
  ]);
});

void test('Skip without a reason: fails', () => {
  for (const skip of ['', '   ']) {
    const out = problems(world({ manifest: { 'paycheck-foo': { skip } } }));
    assert.ok(out.some(m => /paycheck-foo.*reason/.test(m)));
  }
});

void test('A new handler without an API method: fails unless skipped with a reason', () => {
  const noMethod = world({
    methodsText: '',
    manifest: { 'paycheck-foo': { tool: 'list_x' } },
    tools: ['list_x'],
    testText: "'list_x'",
  });
  const out = problems(noMethod);
  assert.equal(out.length, 1);
  assert.match(out[0], /paycheck-foo.*methods\.ts/);
  assert.deepEqual(
    problems({
      ...noMethod,
      manifest: { 'paycheck-foo': { skip: 'read tool arrives in sc-1571' } },
    }),
    [],
  );
});

void test('A tool entry must name a registered, tested tool', () => {
  const base = world({ manifest: { 'paycheck-foo': { tool: 'list_x' } } });
  assert.match(problems(base)[0], /list_x.*not registered/);
  const registered = { ...base, tools: ['list_x'] };
  assert.match(problems(registered)[0], /list_x.*no test/);
  assert.deepEqual(problems({ ...registered, testText: "it('list_x')" }), []);
});

void test('An entry needs exactly one of tool and skip', () => {
  const out = problems(world({ manifest: { 'paycheck-foo': {} } }));
  assert.match(out[0], /paycheck-foo/);
});

void test('API exports outside the baseline need an entry too', () => {
  const out = problems(
    world({
      exports: ['getPaychecks'],
      manifest: { 'paycheck-foo': { skip: 'x' } },
    }),
  );
  assert.equal(out.length, 1);
  assert.match(out[0], /getPaychecks/);
});

void test('findApiExports and findTools read declarations', () => {
  assert.deepEqual(
    findApiExports(
      "export { q } from './q';\nexport async function a() {}\nexport function b() {}\nexport const c = 1;",
    ),
    ['a', 'b', 'c', 'q'],
  );
  assert.deepEqual(
    findTools("tool(\n    'list_a',\n    'x',\n  );\ntool('b_c', 'y')"),
    ['list_a', 'b_c'],
  );
});

void test('A tool named only in comments: fails', () => {
  const ghost = world({
    manifest: { 'paycheck-foo': { tool: 'ghost_tool' } },
    tools: findTools("// tool('ghost_tool', 'x')\n/* tool(\n 'ghost_tool' */"),
    testText: "// it('ghost_tool')\n/* 'ghost_tool' */",
  });
  assert.match(problems(ghost)[0], /ghost_tool.*not registered/);
  const noTest = { ...ghost, tools: ['ghost_tool'] };
  assert.match(problems(noTest)[0], /ghost_tool.*no test/);
});

const assigned = "handlers['zz-new-handler'] = async () => {};";
const noBaseline = { handlers: [], apiExports: [] };

void test('An assigned handler without coverage: fails and names the handler', () => {
  const out = problems(
    world({
      handlers: findHandlers(assigned),
      baseline: noBaseline,
      methodsText: "send('zz-new-handler', args)",
    }),
  );
  assert.equal(out.length, 1);
  assert.match(out[0], /zz-new-handler.*no entry/);
});

void test('An assigned handler with an entry: passes', () => {
  const out = problems(
    world({
      handlers: findHandlers(assigned),
      baseline: noBaseline,
      manifest: { 'zz-new-handler': { skip: 'UI only' } },
    }),
  );
  assert.deepEqual(out, []);
});

void test('An assigned handler across lines: finds the handler', () => {
  assert.deepEqual(
    findHandlers(
      "handlers[\n  'zz-new-handler',\n] = mutator(async () => {});",
    ),
    ['zz-new-handler'],
  );
});

void test('A call is not a registration: a call, a comparison and an argument', () => {
  const text = [
    "await handlers['load-budget']({ id });",
    "if (handlers['x'] === y) {}",
    "if (handlers['x'] == y) {}",
    "run(handlers['x']);",
    "// handlers['commented'] = 1",
    "handlers['real'] = 1;",
  ].join('\n');
  assert.deepEqual(findHandlers(text), ['real']);
});

void test('The baseline holds assigned handlers', () => {
  const baseline = JSON.parse(
    readFileSync(
      new URL('../../packages/mcp/upstream-handlers.json', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(baseline.handlers.includes('api/abort-import'));
});

void test('A commented registration or send does not count', () => {
  assert.deepEqual(
    findHandlers(
      "// app.method('a', x)\n/* app.method('b', x) */\napp.method('c', x)",
    ),
    ['c'],
  );
  const out = problems(
    world({
      methodsText: "// send('paycheck-foo', args)",
      manifest: { 'paycheck-foo': { tool: 'list_x' } },
      tools: ['list_x'],
      testText: "'list_x'",
    }),
  );
  assert.match(out[0], /paycheck-foo.*methods\.ts/);
});
