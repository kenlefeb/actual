# Tasks

## 1. Fork release entries

- [ ] 1.1 Add `fork/scripts/generate-release-news.mjs` exporting `buildForkNewsFeed(notesDir)` and writing `packages/desktop-client/src/data/fork-news.json` when run directly, plus a root `generate:fork-news` script; generate entries for 26.10.1-alpha.1 through alpha.4 and verify the alpha.4 entry has version, date `2026-10-27`, the unofficial statement in its body, its Features section in details and a GitHub link
- [ ] 1.2 Add `packages/desktop-client/src/news/forkNews.test.ts` asserting the committed `fork-news.json` matches `buildForkNewsFeed` output and contains an entry for the version in `packages/desktop-client/package.json`; add a generator test that a note missing its date line throws naming the file; verify both pass

## 2. Bundled feed

- [ ] 2.1 Add the `REACT_APP_NEWS_FEED_BUNDLED` option to `fetchNewsFeed.ts`: when `true` and no URL override is set, import the bundled `news.json` and `fork-news.json`, validate them, and return entries merged newest first (fork first on equal dates) without a network request; extend `fetchNewsFeed.test.ts` for the bundled path, ordering, and that the override and preview paths are unchanged; verify the tests pass
- [ ] 2.2 Commit `packages/desktop-client/.env.production` setting `REACT_APP_NEWS_FEED_BUNDLED=true`; verify with `yarn workspace @actual-app/web build` that the built app contains the fork entry titles and no request to `raw.githubusercontent.com/actualbudget` is needed for the feed

## 3. Release rule documentation

- [ ] 3.1 Add the rule to `AGENTS.md` (Private customized build versions): every release adds its note to the notifications feed with `yarn generate:fork-news`, and the feed test must pass; update `fork/README.md` release steps; verify `yarn lint` passes for the edited files

## 4. Integration checks

- [ ] 4.1 Run `yarn typecheck`, `yarn lint` and `yarn test` from the repository root and verify they pass, except the known local-only `.memsearch/` and `.vexp/` format findings
- [ ] 4.2 Serve a production build locally, open `/notifications` and verify the fork entries appear newest first above upstream's 26.10.0 entry; with `lastSeenNewsDate` set before the alpha.4 date and the app version at alpha.4, verify the "What's new in Actual 26.10.1-alpha.4" notification appears

## Workflow follow-up

- In `actual-hosting`: add the rule to `AGENTS.md` and a check (beside `check_release_notes.py`) that fails when the pinned fork commit's `fork-news.json` has no entry for `buildVersion`; run its tests.
- The release that ships this change (for example 26.10.1-alpha.5) needs its own release note and feed entry, per the new rule.
- Archive this change after review so `fork-release-news` becomes a main spec.
