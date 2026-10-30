# Ken’s Actual fork

Unofficial Actual Budget fork for synthetic evaluation and development. The MIT license and upstream attribution remain unchanged.

## Branches and migration

- `master` is the upstream mirror: it tracks the upstream snapshot cloned when this fork was created (`21c2b3f703142f858af4c653a31e675ca5ff85d7` at migration). It carries no fork work and is not the default branch.
- `development` is the fork's default branch (sc-697, [ADR 0008](../docs/adr/0008-development-becomes-default-branch.md)), so pull requests, Dependabot, code scanning and scheduled workflows target it. Upstream-only workflows are guarded with `github.repository == 'actualbudget/actual'` so they never run here.
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

Prepare focused upstream branches from current upstream before submitting. Exclude fork version bumps, this directory, private release policy, deployment-specific documentation, the fork-only `.github/workflows/fork-ci.yml` and `.github/workflows/semgrep.yml`, the `check:openspec-shortcut` and `check:spec-scenarios` scripts in `package.json`, the mutation report (`.github/workflows/fork-mutation-report.yml`, `packages/loot-core/stryker.config.mjs`, `vitest.mutation.config.ts`, the `mutation-report` script and the Stryker dev dependencies), the `x-shortcut` keys and Shortcut rules in `openspec/`, the agent-skills setup (`docs/agents/` and the "Agent skills" section of `CLAUDE.md`), the fork's ADRs and glossary (`docs/adr/` and `GLOSSARY.md`), the Impatient Programming primer (`primer.md` and the "Impatient Programming" section of `AGENTS.md`), the "Shortcut stories" section of `AGENTS.md`, and the per-address IPv6 rate limits (`ipv6Subnet: false` in `packages/sync-server/src/app.ts` and `app-account.js`), which are safe only because this fork's server is reachable only on the tailnet. Some original commits mix those concerns; do not submit the entire development branch as one upstream pull request.

## Upstream values the fork overrides

These differ from upstream on purpose and are dropped once upstream adopts the same values. Each overridden line carries a `fork:` comment.

| Override                                                                                                                                                                | Where                                                                                                | Why                                                                                                    | Upstream follow-up                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Theme tokens for WCAG AA text contrast: light `pageTextSubdued` navy600 and `warningText` orange800, dark `pageTextSubdued` navy200, midnight `pageTextSubdued` navy300 | `packages/component-library/src/themes/{light,dark,midnight}.css`, checked by `contrast.web.test.ts` | Upstream's secondary and light warning text measure 1.8–4.7:1 on the backgrounds they sit on (sc-1212) | sc-1096, branch `upstream/subdued-text-contrast` |

## CI

Upstream's workflows run on Depot runners, which this fork lacks, so they are disabled in the fork's Actions settings rather than edited (keeping upstream syncs conflict-free). `fork-ci.yml` runs typecheck, lint and tests on GitHub-hosted runners for every PR to and push on `development`, plus `yarn check:openspec-shortcut` (`fork/scripts/check-openspec-shortcut.mjs`), which checks that OpenSpec changes name their Shortcut stories and, on pull requests, that every pull request names a story in its title or branch (bots exempt; see `docs/agents/issue-tracker.md`). Its `mobile-e2e` job runs all the mobile Playwright tests (`*.mobile.test.ts`, with one worker and no retries) in the same Docker setup as the actual-hosting staging build; on a pull request it is skipped only when every changed file is under `docs/`, `openspec/`, `fork/` or `upcoming-release-notes/`, or is Markdown. Pull request runs cancel their own superseded runs, but every push to `development` gets a full run of `fork-ci.yml` and `fork-build.yml` that is never cancelled, so each merged commit has a result: a red one means the combination that merged is broken (sc-946). `semgrep.yml` runs Semgrep for the `blacksmith_press` org: new findings on each PR, a full scan on each push to `development`; it needs the `SEMGREP_APP_TOKEN` secret. Re-enable a workflow with `gh workflow enable <name> -R kenlefeb/actual` only after pointing it at a runner the fork has.

`fork-build.yml` builds the app before merge, so a broken build shows up here rather than at the actual-hosting staging build. Its `browser-build` job runs `yarn build:browser --skip-translations` in its own job, so the build's leftover `packages/*/@types` and `dist` never reach `fork-ci.yml`'s typecheck. Its `docker-build` job builds the full `sync-server.Dockerfile` image, the one actual-hosting builds. On a pull request, both jobs skip only when every changed file is in `docs/`, `openspec/`, `fork/` or `upcoming-release-notes/`, or is Markdown (the same rule as `mobile-e2e`); they then pass without running, so both can be required checks. Any other change runs both, including source under `packages/`, since the image also runs `yarn build:server`. Pushes to `development` always run both.

`fork-mutation-report.yml` is a report, never a required check, and never fails a pull request. It runs [Stryker](https://stryker-mutator.io/) mutation testing on the shared date and money modules (`packages/loot-core/src/shared/{paychecks,business-calendars,relative-dates,schedules}.ts`) against their own unit tests (`vitest.mutation.config.ts`), and lists the spec scenarios no test names. The job summary shows the mutation score per module and the scenario list; the artifact `mutation-report` holds the HTML and JSON reports. It runs nightly at 07:30 UTC, on demand (`gh workflow run fork-mutation-report.yml -R kenlefeb/actual --ref development`), and on pull requests that change its workflow or Stryker config. GitHub runs schedules from the default branch, so the nightly schedule fires only while `development` is the default branch (sc-697). Run it locally with `yarn workspace @actual-app/core run mutation-report` (add `--mutate src/shared/paychecks.ts` for one module).

`yarn check:spec-scenarios` (`fork/scripts/check-spec-scenarios.mjs`) lists every `#### Scenario:` in `openspec/specs/` whose exact name appears in no tracked test file, and always exits 0. A test names a scenario by putting it in its title, as in `it('Both devices add a deposit', …)` or `it('Delete a deposit schedule from Schedules: offers Edit paycheck and no Delete', …)`.

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
