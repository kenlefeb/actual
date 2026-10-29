// Checks that OpenSpec changes name their Shortcut stories, the links that
// docs/agents/issue-tracker.md describes. Run from the repo root:
// `yarn check:openspec-shortcut [--base <ref>] [--require-story]`.
//
// Always: every change (active and archived) has `x-shortcut` with an epic and
// stories in its `.openspec.yaml`, and a multi-story change ends each numbered
// `tasks.md` group heading with one of its stories.
//
// With --base (pull requests): a PR that ticks tasks of an active change must
// name one of that change's stories in its title (PR_TITLE) or branch
// (PR_HEAD_REF). --require-story also fails any PR that names no story at all,
// except PRs opened by bots (PR_AUTHOR ending in `[bot]`).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANGES_PATH = 'openspec/changes';

export function storyIds(text) {
  return [...(text ?? '').matchAll(/\bsc-(\d+)\b/gi)].map(match =>
    Number(match[1]),
  );
}

// Reads the `x-shortcut` block of a `.openspec.yaml`. Only the shape this
// repo writes is accepted:
//   x-shortcut:
//     epic: 28
//     stories: [56, 57]
export function parseShortcutMeta(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => /^x-shortcut:\s*$/.test(line));
  if (start === -1) {
    return { epic: null, stories: [], errors: ['has no x-shortcut block'] };
  }

  const fields = {};
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!match) {
      break;
    }
    fields[match[1]] = match[2];
  }

  const errors = [];
  const epic = /^\d+$/.test(fields.epic ?? '') ? Number(fields.epic) : null;
  if (!epic) {
    errors.push('x-shortcut.epic must be a Shortcut epic id');
  }
  const list = /^\[(.*)\]$/.exec(fields.stories ?? '');
  const items = list ? list[1].split(',').map(item => item.trim()) : [];
  const stories = items.every(item => /^\d+$/.test(item))
    ? items.map(Number)
    : [];
  if (stories.length === 0) {
    errors.push('x-shortcut.stories must be a list of Shortcut story ids');
  }
  return { epic, stories, errors };
}

// Errors for one change. `tasksText` is null when the change has no tasks.md.
export function checkChange({ name, metaText, tasksText }) {
  if (metaText == null) {
    return [`${name}: has no .openspec.yaml`];
  }
  const { stories, errors } = parseShortcutMeta(metaText);
  const result = errors.map(error => `${name}: .openspec.yaml ${error}`);
  if (errors.length > 0 || stories.length < 2 || tasksText == null) {
    return result;
  }

  for (const heading of tasksText.match(/^## \d+\..*$/gm) ?? []) {
    const match = /\(sc-(\d+)\)$/.exec(heading);
    if (!match) {
      result.push(
        `${name}: tasks.md heading "${heading}" must end with (sc-<id>), one of ${stories.join(', ')}`,
      );
    } else if (!stories.includes(Number(match[1]))) {
      result.push(
        `${name}: tasks.md heading "${heading}" names sc-${match[1]}, which is not in x-shortcut.stories`,
      );
    }
  }
  return result;
}

// Names of active changes whose tasks.md has a box ticked in a unified diff.
export function changesWithTickedTasks(diffText) {
  const removed = new Map();
  const added = new Map();
  let change = null;
  for (const line of diffText.split('\n')) {
    // One folder below changes/ is an active change; archived ones sit deeper.
    const file = /^\+\+\+ b\/openspec\/changes\/([^/]+)\/tasks\.md$/.exec(line);
    if (line.startsWith('+++ ')) {
      change = file ? file[1] : null;
      continue;
    }
    const task = change && /^([+-])\s*- \[([ xX])\] (.*)$/.exec(line);
    if (task) {
      const [, sign, mark, text] = task;
      const isTicked = mark !== ' ';
      // An open box removed and the same text added ticked is a tick.
      if ((sign === '-') === isTicked) {
        continue;
      }
      const target = sign === '-' ? removed : added;
      if (!target.has(change)) {
        target.set(change, new Set());
      }
      target.get(change).add(text);
    }
  }
  return [...added.keys()].filter(name =>
    [...added.get(name)].some(text => removed.get(name)?.has(text)),
  );
}

// Errors for a pull request, given the stories each changed change names.
export function checkPullRequest({
  title,
  headRef,
  author,
  tickedChanges,
  storiesByChange,
  requireStory,
}) {
  const named = [...storyIds(title), ...storyIds(headRef)];
  const errors = [];
  if (requireStory && named.length === 0 && !author?.endsWith('[bot]')) {
    errors.push(
      'pull request names no Shortcut story: end the title with [sc-<id>] or use a branch containing sc-<id>',
    );
  }
  for (const name of tickedChanges) {
    const stories = storiesByChange.get(name) ?? [];
    if (!stories.some(story => named.includes(story))) {
      errors.push(
        `pull request ticks tasks of ${name} but names none of its stories (${stories.map(story => `sc-${story}`).join(', ')}) in its title or branch`,
      );
    }
  }
  return errors;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readChanges(root) {
  const changesDir = join(root, CHANGES_PATH);
  const archiveDir = join(changesDir, 'archive');
  const dirs = [
    ...readdirSync(changesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'archive')
      .map(entry => ({ name: entry.name, dir: join(changesDir, entry.name) })),
    ...readdirSync(archiveDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: `archive/${entry.name}`,
        dir: join(archiveDir, entry.name),
      })),
  ];
  return dirs.map(({ name, dir }) => ({
    name,
    metaText: readIfExists(join(dir, '.openspec.yaml')),
    tasksText: readIfExists(join(dir, 'tasks.md')),
  }));
}

export function check({ root, diffText, pullRequest }) {
  const changes = readChanges(root);
  const errors = changes.flatMap(checkChange);
  if (diffText != null) {
    const storiesByChange = new Map(
      changes.map(change => [
        change.name,
        change.metaText ? parseShortcutMeta(change.metaText).stories : [],
      ]),
    );
    errors.push(
      ...checkPullRequest({
        ...pullRequest,
        tickedChanges: changesWithTickedTasks(diffText),
        storiesByChange,
      }),
    );
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex === -1 ? null : args[baseIndex + 1];
  const diffText = base
    ? execFileSync(
        'git',
        [
          'diff',
          '--unified=0',
          base,
          'HEAD',
          '--',
          `${CHANGES_PATH}/*/tasks.md`,
        ],
        { encoding: 'utf8' },
      )
    : null;
  const errors = check({
    root: process.cwd(),
    diffText,
    pullRequest: {
      title: process.env.PR_TITLE,
      headRef: process.env.PR_HEAD_REF,
      author: process.env.PR_AUTHOR,
      requireStory: args.includes('--require-story'),
    },
  });
  for (const error of errors) {
    console.error(error);
  }
  if (errors.length > 0) {
    console.error(
      `\n${errors.length} OpenSpec ↔ Shortcut problem(s). See docs/agents/issue-tracker.md.`,
    );
    process.exit(1);
  }
  console.log('OpenSpec changes and Shortcut stories are linked.');
}
