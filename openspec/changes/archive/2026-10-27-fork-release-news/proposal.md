# Proposal

## Why

Every fork release already has fork-labeled release notes, but users never see them in the app: the `/notifications` page and the "What's new" notification read upstream's `news.json` from `actualbudget/actual` `master`, which never contains fork releases. Ken wants a release rule that each fork release's notes appear on `/notifications`.

## What Changes

- New release rule: every fork release SHALL add its release notes to the in-app notifications feed, recorded in the fork's `AGENTS.md` beside the existing release-note rule.
- Fork production builds read the feed bundled into the build instead of upstream's remote file, so each build shows exactly the notes for its own version and earlier ones, and never notes for undeployed versions.
- Fork release entries live in a separate fork-owned file, generated from `fork/release-notes/<version>.md`, and are merged with upstream's bundled entries newest first. Upstream's `news.json` and its generator stay untouched, so upstream regeneration never removes fork entries.
- Existing notes for 26.10.1-alpha.1 through alpha.4 are added as entries.
- A test fails when any fork release note, or the current package version, has no feed entry.
- Running a fork release for the first time shows the existing "What's new in Actual <version>" notification for that version.

Out of scope: prerelease-aware version comparison (upstream never publishes prereleases, and a bundled feed never contains versions newer than the build); a "deployed" indicator; changing upstream's feed tooling. Known limitation: if two fork releases share a date, the "What's new" notification may name either one; the notifications page lists both.

Follow-up outside this repository (not editable from this change): `actual-hosting` adds the same rule to its `AGENTS.md` and a release check that fails when the pinned fork commit has no feed entry for `buildVersion`.

## Capabilities

### New Capabilities

- `fork-release-news`: how fork releases' notes reach the in-app notifications feed and the rule that every release provides them.

### Modified Capabilities

None.

## Impact

- Code: `packages/desktop-client/src/news/fetchNewsFeed.ts` (bundled-feed option and merge), new `packages/desktop-client/src/data/fork-news.json`, new committed `packages/desktop-client/.env.production` enabling the bundled feed for production builds only.
- Tooling: a fork script that generates `fork-news.json` from `fork/release-notes/`.
- Docs: `AGENTS.md` release rule; `fork/README.md` release steps.
- Local development and tests keep upstream's remote-feed behavior unless the option is set.
- Shipping this needs a new fork version (for example 26.10.1-alpha.5) whose own note becomes its first new entry.
