import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import forkNews from '#data/fork-news.json';

const repoRoot = join(__dirname, '../../../..');
const notesDir = join(repoRoot, 'fork/release-notes');
// Fork release tooling lives outside the workspaces and their TypeScript
// projects, so it is loaded at runtime rather than imported statically
const generatorPath = join(repoRoot, 'fork/scripts/generate-release-news.mjs');

type Generator = {
  buildForkNewsFeed: (notesDir: string) => unknown;
  parseReleaseNote: (text: string, file: string) => unknown;
};

async function loadGenerator(): Promise<Generator> {
  return import(/* @vite-ignore */ generatorPath);
}

describe('fork release news', () => {
  it('matches the release notes (run `yarn generate:fork-news`)', async () => {
    const { buildForkNewsFeed } = await loadGenerator();
    expect(forkNews).toEqual(buildForkNewsFeed(notesDir));
  });

  it('has an entry for the current release version', () => {
    const { version } = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
    );
    expect(forkNews.entries.map(entry => entry.version)).toContain(version);
  });

  it('names the file when a release note has no date line', async () => {
    const { parseReleaseNote } = await loadGenerator();
    expect(() =>
      parseReleaseNote(
        '# Release 9.9.9 — fork\n\nSoon\n\nDocker Tag: x\n\n#### Features\n',
        '9.9.9.md',
      ),
    ).toThrow('9.9.9.md: expected a date line');
  });
});
