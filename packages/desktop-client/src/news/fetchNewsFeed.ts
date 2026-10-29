import * as Platform from '@actual-app/core/shared/platform';

import { newsFeedFixture } from './fixtures';
import { NEWS_FEED_SCHEMA_VERSION } from './types';
import type { NewsEntry, NewsFeed } from './types';

// Released builds read the file committed on `master`, the same way the custom
// theme catalog is fetched (hooks/useThemeCatalog.ts).
/**
 * Message of the error thrown when the feed loaded but isn't in a format this
 * version understands, so callers can tell it apart from a failed download.
 */
export const UNSUPPORTED_NEWS_FEED_FORMAT = 'Unsupported news feed format';

const REPO_NEWS_FEED_URL =
  'https://raw.githubusercontent.com/actualbudget/actual/master/packages/desktop-client/src/data/news.json';

/**
 * Where to load `news.json` from, in priority order:
 *
 * 1. `REACT_APP_NEWS_FEED_URL` - explicit override, e.g. in a local `.env`
 *    file in `packages/desktop-client`.
 *
 * Without an override, `REACT_APP_NEWS_FEED_BUNDLED=true` (set for fork
 * builds in `.env.browser` and `.env.production`) skips fetching entirely and
 * `fetchNewsFeed` reads the bundled upstream and fork feeds instead.
 * 2. Netlify PR previews (`REACT_APP_REVIEW_ID` is set) serve the copy in
 *    their own build, i.e. exactly the file committed on the PR branch. This
 *    also works for PRs from forks, whose branches aren't on GitHub upstream.
 * 3. The committed file on `master`.
 */
export async function getNewsFeedUrl(): Promise<string> {
  const override = import.meta.env.REACT_APP_NEWS_FEED_URL;
  if (override) {
    return override;
  }

  if (import.meta.env.REACT_APP_REVIEW_ID) {
    // `?url` makes Vite emit the file as a static asset and hand back its URL.
    const { default: bundledUrl } = await import('../data/news.json?url');
    return bundledUrl;
  }

  return REPO_NEWS_FEED_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isNewsEntry(value: unknown): value is NewsEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.type === 'release' || value.type === 'post') &&
    typeof value.title === 'string' &&
    typeof value.date === 'string' &&
    typeof value.url === 'string' &&
    typeof value.body === 'string' &&
    isOptionalString(value.version) &&
    isOptionalString(value.details)
  );
}

/** Runtime shape check on the untrusted JSON we fetched. */
function isNewsFeed(value: unknown): value is NewsFeed {
  return (
    isRecord(value) &&
    value.schemaVersion === NEWS_FEED_SCHEMA_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.every(isNewsEntry)
  );
}

/**
 * Upstream and fork entries combined, newest first. The sort is stable, so
 * fork entries stay ahead of upstream ones published the same day.
 */
export function mergeNewsEntries(
  upstream: NewsEntry[],
  fork: NewsEntry[],
): NewsEntry[] {
  return [...fork, ...upstream].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The feeds bundled into this build: upstream's `news.json` plus the fork's
 * release entries. Pins notes to the installed version and needs no network.
 */
async function loadBundledNewsFeed(): Promise<NewsFeed> {
  const [{ default: upstream }, { default: fork }] = await Promise.all([
    import('#data/news.json'),
    import('#data/fork-news.json'),
  ]);
  if (!isNewsFeed(upstream) || !isNewsFeed(fork)) {
    throw new Error('Unsupported bundled news feed format');
  }
  return {
    schemaVersion: NEWS_FEED_SCHEMA_VERSION,
    entries: mergeNewsEntries(upstream.entries, fork.entries),
  };
}

export async function fetchNewsFeed(): Promise<NewsFeed> {
  if (Platform.isPlaywright) {
    return newsFeedFixture;
  }

  if (
    !import.meta.env.REACT_APP_NEWS_FEED_URL &&
    import.meta.env.REACT_APP_NEWS_FEED_BUNDLED === 'true'
  ) {
    return loadBundledNewsFeed();
  }

  const response = await fetch(await getNewsFeedUrl());
  if (!response.ok) {
    throw new Error(`Failed to load news feed (HTTP ${response.status})`);
  }

  const json: unknown = await response.json();
  if (!isNewsFeed(json)) {
    throw new Error(UNSUPPORTED_NEWS_FEED_FORMAT);
  }
  return json;
}
