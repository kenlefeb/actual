# Ken’s Actual fork

Unofficial Actual Budget fork for synthetic evaluation and development. The MIT license and upstream attribution remain unchanged.

## Branches and migration

- `master` tracks the upstream snapshot cloned when this fork was created (`21c2b3f703142f858af4c653a31e675ca5ff85d7` at migration).
- `development` preserves our six original commits, based on upstream `2bebdbaae0b701120a8cad9d56aafd64fa04c577` (26.10.0), through `4039c27b7d15732b0986624aa51e3afd7e068725` (26.10.1-alpha.2).
- The active local checkout is now `actual`, replacing `actual-development`. The old checkout remains available as a recovery reference.

The migration preserves application files, tests and fixture bytes exactly. It does not merge newer upstream changes or redeploy staging. Keep upstream upgrades separate from feature contributions.

## Changes available for upstream contribution

| Area                                                    | Original commits                                   | Coverage                                                     |
| ------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Await API mutations and preserve sparse split updates   | `a47437f`                                          | Core API and public API regression tests                     |
| Mobile multiline notes, receipt links and sync feedback | `ddef139`, `3b1a54d`                               | Component tests and mobile browser acceptance                |
| Desktop multiline notes and safe split editing          | `4039c27`                                          | Desktop regressions and mobile-to-desktop browser acceptance |
| Fork versions and release policy                        | `cda16fb`, `0283c60`, version changes in `4039c27` | Settings browser check                                       |

Prepare focused upstream branches from current upstream before submitting. Exclude fork version bumps, this directory, private release policy, deployment-specific documentation, the fork-only `.github/workflows/fork-ci.yml` and `.github/workflows/semgrep.yml`, the `check:openspec-shortcut` script in `package.json`, the `x-shortcut` keys and Shortcut rules in `openspec/`, the agent-skills setup (`docs/agents/` and the "Agent skills" section of `CLAUDE.md`), the Impatient Programming primer (`primer.md` and the "Impatient Programming" section of `AGENTS.md`) and the "Shortcut stories" section of `AGENTS.md`. Some original commits mix those concerns; do not submit the entire development branch as one upstream pull request.

## CI

Upstream's workflows run on Depot runners, which this fork lacks, so they are disabled in the fork's Actions settings rather than edited (keeping upstream syncs conflict-free). `fork-ci.yml` runs typecheck, lint and tests on GitHub-hosted runners for every PR to and push on `development`, plus `yarn check:openspec-shortcut` (`fork/scripts/check-openspec-shortcut.mjs`), which checks that OpenSpec changes name their Shortcut stories and, on pull requests, that every pull request names a story in its title or branch (bots exempt; see `docs/agents/issue-tracker.md`). Its `mobile-e2e` job runs the fork's mobile Playwright tests (`mobile-receipts`, `version` and `paychecks`, with one worker and no retries) in the same Docker setup as the actual-hosting staging build; on a pull request it runs only when `packages/`, `yarn.lock` or other dependency files change, and otherwise passes without running. `semgrep.yml` runs Semgrep for the `blacksmith_press` org: new findings on each PR, a full scan on each push to `development`; it needs the `SEMGREP_APP_TOKEN` secret. Re-enable a workflow with `gh workflow enable <name> -R kenlefeb/actual` only after pointing it at a runner the fork has.

## Releases and hosting

Each release adds `release-notes/<version>.md` here, runs `yarn generate:fork-news` and commits the regenerated `packages/desktop-client/src/data/fork-news.json`, so the notes appear on the app's `/notifications` page and in its "What's new" notification. Fork builds read that bundled feed (`packages/desktop-client/.env.browser` for the web app the server serves, `.env.production` for desktop builds) together with upstream's bundled `news.json`, so a deployment only shows notes for its own and earlier versions.

[26.10.1-alpha.1](release-notes/26.10.1-alpha.1.md) and [26.10.1-alpha.2](release-notes/26.10.1-alpha.2.md) record the existing fork releases. These are historical copies; this documentation-only migration does not create a new application version.

The separate private `kenlefeb/actual-hosting` repository retains CI, pinned patches, image promotion, backups, restoration, API helpers and paperwork integration. Its patch `sourceCommit` identifiers now resolve in this fork. Starting with alpha.3, CI builds directly from a pinned development commit, verifies branch ancestry and records the commit in each artifact. Historical patch files remain only for recovery of earlier releases. Do not copy credentials, server data, `.state`, or real paperwork into this public fork.

Start the existing local development service from the sibling hosting checkout:

```sh
ACTUAL_SOURCE_PATH=/Users/kenlefeb/src/github.com/kenlefeb/actual \
  docker compose -f ../actual-hosting/compose.dev.yaml up -d --no-build
```

Run Yarn from the source root. The existing development container provides Linux dependencies: `docker exec actual-source-dev-browser-1 yarn typecheck`.
