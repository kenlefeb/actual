# 8. `development` becomes the fork's default branch

Fork-only; never upstream. Accepted 2026-10-30 (sc-697). The settings change
itself is pending Security Analyst sign-off and is run by the Director.

## Context

`kenlefeb/actual`'s default branch is `master`, a pure mirror of upstream.
`origin/development` is 441 commits ahead of it and 0 behind
(`git rev-list --left-right --count origin/master...origin/development`,
2026-10-30). Everything GitHub keys off the default branch therefore describes
upstream, not what the fork ships:

- Dependabot alerts read the default branch's lockfile. They report
  vulnerabilities the fork already fixed (`body-parser`, sc-565) and miss ones
  only `development` has.
- Scheduled workflows (`schedule:`) run the workflow file as it is on the
  default branch, so fork-only schedules on `development` never fire.
- Code scanning's default-branch view, PR base defaults (`gh pr create`, the
  GitHub UI) and new worktrees all start from `master`.

## Decision

Yes: make `development` the default branch. `master` stays the upstream mirror
and is only ever fast-forwarded from upstream.

## What would break, and the fix for each

1. **Upstream workflows that fire on the default branch.** Audit of
   `.github/workflows`:
   - Rule as implemented: every upstream release, publish and scheduled job
     carries `if: github.repository == 'actualbudget/actual'` (ANDed with any
     existing condition), so none can run on the fork whatever the default
     branch is. Guarded: `docker-nightly`, `docker-release`, `count-points`,
     `stale`, `publish-nightly-electron`, `publish-npm-packages`,
     `publish-crdt`, `publish-ios`, `publish-mac-app-store`,
     `publish-flathub`, `publish-microsoft-store`, `netlify-release`,
     `electron-master`, and the `generate-release-notes` job in
     `release-notes`. `cut-release-branch`, `i18n-string-extract-master`,
     `nightly-theme-catalog-scan` and `discord-release-notifications` were
     already guarded.
   - Deliberately unguarded: pull-request CI (`build`, `check`, `e2e-test`
     and similar), `codeql.yml` (its weekly scan is wanted; `development` is
     added to its push branches) and the `fork-*` and `semgrep` workflows.
   - `cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}` in
     `build.yml`, `check.yml`, `codeql.yml`, `dependency-review.yml`: after the
     switch, in-progress runs on `development` are cancelled by the next push.
     Change to `refs/heads/development`.
2. **Dependabot.** No `dependabot.yml` exists, so alerts and security updates
   follow the default branch automatically. Expect a one-time reshuffle: stale
   alerts auto-close, new ones appear. The Security Analyst re-triages once.
3. **Docs and notes that assume the default is the mirror**: `fork/README.md`,
   `docs/agents/*`, the fork-sync instructions and memory notes. Update them in
   the same PR as the workflow fixes.
4. **Branch protection.** Rules are per branch and carry over. `master` gets a
   documented mirror-only rule (no direct pushes except the sync).
5. **PR base defaults.** They improve: `--base development` becomes redundant.
   Open PRs against `master` (if any) are untouched.
6. Old `blob/master/...` links still work.

## Steps (Security Analyst signs off, Director executes)

1. Snapshot: `gh api repos/kenlefeb/actual --jq .default_branch` (expect
   `master`) and record it on sc-697.
2. Merge a PR (reviewed per the matrix) with the workflow guards and the
   `refs/heads/development` changes from item 1, plus the doc fixes from
   item 3. Do this first so no unguarded schedule or concurrency rule flips
   with the setting.
3. Security Analyst comments approval on sc-697 ("Repository settings" in
   `docs/agents/team.md`).
4. Switch: `gh api -X PATCH repos/kenlefeb/actual -f default_branch=development`.
5. Verify: `gh api repos/kenlefeb/actual --jq .default_branch`; Dependabot
   alerts page lists `development`'s lockfile; next scheduled runs are the
   expected ones only.
6. Rollback: `gh api -X PATCH repos/kenlefeb/actual -f default_branch=master`.

## Consequences

- Alerts, scanning and schedules describe what ships.
- Production is untouched. `master` is not a deployed branch.
- The upstream sync keeps working as long as it targets `master` by name.

## Links

- Story: sc-697. Related: sc-568 (Dependabot), sc-565, sc-62.
