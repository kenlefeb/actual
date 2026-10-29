// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  changesWithTickedTasks,
  check,
  checkChange,
  checkPullRequest,
  parseShortcutMeta,
} from './check-openspec-shortcut.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const meta = stories =>
  `schema: spec-driven\ncreated: 2026-10-28\nx-shortcut:\n  epic: 28\n  stories: [${stories}]\n`;

await test('parseShortcutMeta: reads the epic and stories', () => {
  assert.deepEqual(parseShortcutMeta(meta('56, 57')), {
    epic: 28,
    stories: [56, 57],
    errors: [],
  });
});

await test('parseShortcutMeta: rejects a missing block, epic or story list', () => {
  assert.deepEqual(parseShortcutMeta('schema: spec-driven\n').errors, [
    'has no x-shortcut block',
  ]);
  assert.equal(
    parseShortcutMeta('x-shortcut:\n  stories: [1]\n').errors.length,
    1,
  );
  assert.equal(parseShortcutMeta(meta('')).errors.length, 1);
  assert.equal(parseShortcutMeta(meta('56, sc-57')).errors.length, 1);
});

await test('parseShortcutMeta: stops at the end of the block', () => {
  const text = 'x-shortcut:\n  epic: 28\nother:\n  stories: [1]\n';
  assert.equal(parseShortcutMeta(text).stories.length, 0);
});

const tasks = '# Tasks\n\n## 1. Flag (sc-56)\n\n## 2. List\n\n## Notes\n';

await test('checkChange: requires .openspec.yaml', () => {
  assert.deepEqual(checkChange({ name: 'c', metaText: null }), [
    'c: has no .openspec.yaml',
  ]);
});

await test('checkChange: requires story ids on numbered groups of a multi-story change', () => {
  const errors = checkChange({
    name: 'c',
    metaText: meta('56, 57'),
    tasksText: tasks,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"## 2\. List" must end with \(sc-<id>\)/);
});

await test('checkChange: rejects a group story that the change does not list', () => {
  const errors = checkChange({
    name: 'c',
    metaText: meta('57, 58'),
    tasksText: '## 1. Flag (sc-56)\n',
  });
  assert.match(errors[0], /names sc-56, which is not in/);
});

await test('checkChange: does not require group ids for a single-story change', () => {
  assert.deepEqual(
    checkChange({ name: 'c', metaText: meta('56'), tasksText: tasks }),
    [],
  );
});

const diff = (path, lines) =>
  `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${lines.join('\n')}\n`;
const tasksPath = 'openspec/changes/paycheck-planning-ux/tasks.md';

await test('changesWithTickedTasks: finds a ticked box', () => {
  const text = diff(tasksPath, ['-- [ ] 6.1 Ship it', '+- [x] 6.1 Ship it']);
  assert.deepEqual(changesWithTickedTasks(text), ['paycheck-planning-ux']);
});

await test('changesWithTickedTasks: ignores new, unticked, edited and archived tasks', () => {
  const texts = [
    diff(tasksPath, ['+- [ ] 7.1 New task']),
    diff(tasksPath, ['-- [x] 6.1 Ship it', '+- [ ] 6.1 Ship it']),
    diff(tasksPath, ['-- [ ] 6.1 Ship it', '+- [x] 6.1 Ship it later']),
    diff('openspec/changes/archive/2026-10-27-paychecks/tasks.md', [
      '-- [ ] 1.1 Done',
      '+- [x] 1.1 Done',
    ]),
  ];
  for (const text of texts) {
    assert.deepEqual(changesWithTickedTasks(text), []);
  }
});

const storiesByChange = new Map([['paycheck-planning-ux', [56, 491]]]);
const pr = overrides => ({
  title: '[AI] refine(release): ship paychecks',
  headRef: 'refine/release',
  author: 'kenlefeb',
  tickedChanges: [],
  storiesByChange,
  requireStory: false,
  ...overrides,
});

await test('checkPullRequest: accepts a story named in the title or the branch', () => {
  const ticked = { tickedChanges: ['paycheck-planning-ux'] };
  assert.deepEqual(
    checkPullRequest(pr({ ...ticked, title: '[AI] ship it [sc-491]' })),
    [],
  );
  assert.deepEqual(
    checkPullRequest(pr({ ...ticked, headRef: 'sc-491-ship-paychecks' })),
    [],
  );
});

await test('checkPullRequest: rejects ticked tasks without one of the change stories', () => {
  const errors = checkPullRequest(
    pr({
      title: '[AI] ship it [sc-483]',
      tickedChanges: ['paycheck-planning-ux'],
    }),
  );
  assert.match(errors[0], /ticks tasks of paycheck-planning-ux/);
});

await test('checkPullRequest: requires a story only when asked, and never from bots', () => {
  assert.deepEqual(checkPullRequest(pr()), []);
  assert.equal(checkPullRequest(pr({ requireStory: true })).length, 1);
  assert.deepEqual(
    checkPullRequest(pr({ requireStory: true, author: 'dependabot[bot]' })),
    [],
  );
});

await test('repository: links every OpenSpec change to Shortcut', () => {
  assert.deepEqual(check({ root: repoRoot }), []);
});
