// Generates packages/desktop-client/src/data/fork-news.json, the fork's
// in-app notifications entries, from fork/release-notes/<version>.md.
// Run from the repo root: `yarn generate:fork-news`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'https://github.com/kenlefeb/actual/blob/development';
const NOTES_PATH = 'fork/release-notes';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function isoDate(line, file) {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(line.trim());
  const month = match ? MONTHS.indexOf(match[1]) + 1 : 0;
  if (!month) {
    throw new Error(`${file}: expected a date line like "October 27, 2026"`);
  }
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

export function parseReleaseNote(text, file) {
  const version = basename(file, '.md');
  const lines = text.split('\n');
  if (!lines[0].startsWith(`# Release ${version} `)) {
    throw new Error(`${file}: first line must be "# Release ${version} — …"`);
  }
  const dateIndex = lines.findIndex((line, i) => i > 0 && line.trim());
  const dockerIndex = lines.findIndex(line => line.startsWith('Docker Tag:'));
  const detailsIndex = lines.findIndex(line => line.startsWith('#### '));
  if (dockerIndex === -1 || detailsIndex === -1) {
    throw new Error(`${file}: missing "Docker Tag:" line or "####" sections`);
  }
  return {
    id: `fork-release-${version}`,
    type: 'release',
    title: `Release ${version} — Ken's Actual fork`,
    date: isoDate(lines[dateIndex], file),
    version,
    url: `${REPO_URL}/${NOTES_PATH}/${version}.md`,
    body: lines
      .slice(dateIndex + 1, dockerIndex)
      .join('\n')
      .trim(),
    details: lines.slice(detailsIndex).join('\n').trim(),
  };
}

export function buildForkNewsFeed(notesDir) {
  const entries = readdirSync(notesDir)
    .filter(name => name.endsWith('.md'))
    .map(name =>
      parseReleaseNote(readFileSync(join(notesDir, name), 'utf-8'), name),
    )
    // Newest first; versions break same-day ties
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.version.localeCompare(a.version, 'en', { numeric: true }),
    );
  return { schemaVersion: 1, entries };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const feed = buildForkNewsFeed(join(root, NOTES_PATH));
  writeFileSync(
    join(root, 'packages/desktop-client/src/data/fork-news.json'),
    JSON.stringify(feed, null, 2) + '\n',
  );
  console.log(`Wrote ${feed.entries.length} fork release entries`);
}
