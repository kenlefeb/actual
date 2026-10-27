# Design

## Context

See proposal.md for motivation and specs/fork-release-news/spec.md for behavior. `packages/desktop-client/src/news/fetchNewsFeed.ts` loads `news.json` from, in order: `REACT_APP_NEWS_FEED_URL`, the bundled copy on PR previews (`REACT_APP_REVIEW_ID`), else upstream `master` on GitHub. Upstream generates the bundled `src/data/news.json` from blog posts (`yarn generate:news-feed`); autofix and the "News feed check" workflow keep it in step, so hand edits would be overwritten. The notifications page renders entries in feed order. `getReleaseToNotify` picks the newest unseen release whose version is not newer than the running one; its version comparison ignores prerelease suffixes. Vite loads `.env.production` only for production builds, and `packages/desktop-client/.gitignore` ignores `.env` but not `.env.production`.

## Goals / Non-Goals

**Goals:**
- Fork builds show their own release notes, pinned to the build.
- Keep upstream files and tooling untouched to avoid merge conflicts.

**Non-Goals:**
- Prerelease-aware version comparison or a "deployed" indicator.
- Changing upstream's feed generator, schema version or workflows.
- The `actual-hosting` enforcement, which lives in that repository.

## Decisions

### Separate fork entries file
Fork entries live in `packages/desktop-client/src/data/fork-news.json` using the existing `NewsFeed` schema (`schemaVersion: 1`, release entries only). Upstream's `news.json` is not edited.

- Why: upstream regeneration rewrites `news.json` from blog posts and would drop fork entries; a separate file never conflicts when merging upstream.
- Alternative: fork blog posts flagged `in_app_notification` so upstream's generator picks them up. Rejected because it adds fork content to the docs site and still edits upstream-generated output.

### Bundled feed option merged in the client
Add `REACT_APP_NEWS_FEED_BUNDLED`. When it is `true` and no URL override is set, `fetchNewsFeed` imports both bundled JSON files, validates them with the existing checks, and returns one feed whose entries are sorted by date, newest first (fork entries first on equal dates). No network request is made. A committed `packages/desktop-client/.env.production` sets the option, so fork release builds use it while `yarn start`, tests and Netlify previews keep upstream behavior.

- Why: pins notes to the build (no undeployed notes, works offline) with a one-line, fork-only configuration file and a small branch in existing code.
- Alternative: point `REACT_APP_NEWS_FEED_URL` at the fork's development branch. Rejected: shows undeployed notes and the prerelease comparison bug would announce them.

### Generated from release notes
`fork/scripts/generate-release-news.mjs` exports `buildForkNewsFeed(notesDir)` and, when run directly, writes `fork-news.json`. For each `fork/release-notes/<version>.md` it takes: `version` from the filename; `title` "Release <version> — Ken’s Actual fork"; `date` from the note's date line (for example "October 27, 2026" → `2026-10-27`); `body` from the text between the date line and the "Docker Tag:" line (the unofficial statement and summary); `details` from the first `####` heading to the end; `url` `https://github.com/kenlefeb/actual/blob/development/fork/release-notes/<version>.md`; `id` `fork-release-<version>`. A root script `yarn generate:fork-news` runs it. It uses only Node built-ins.

### Enforcement test
`packages/desktop-client/src/news/forkNews.test.ts` asserts that the committed `fork-news.json` equals `buildForkNewsFeed('fork/release-notes')` (so it is never stale) and that it contains an entry for the version in `packages/desktop-client/package.json`. Because release CI runs the test suite, a release without notes in the feed fails.

## Risks / Trade-offs

- [Two fork releases on the same date make the "What's new" notification name either one] → Accepted and documented; the notifications page still lists both.
- [Upstream announcements after the fork's base are not shown until upstream is merged] → Accepted; the bundled upstream entries update with each upstream merge.
- [Release-note format drift breaks parsing] → The generator throws with the file name on a missing title, date or Docker Tag line, and the test surfaces it.
- [Electron/desktop production builds also read the bundled feed] → Intended for the fork; there is no separate desktop distribution.

## Migration Plan

Generate entries for alpha.1 through alpha.4 when adding the file. The release that ships this change adds its own note and entry. Rollback: delete `.env.production` to return to upstream's remote feed.
