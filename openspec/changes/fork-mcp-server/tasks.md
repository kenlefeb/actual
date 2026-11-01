# Tasks

## 1. Typed API methods (sc-1568)

- [x] 1.1 Spec `api-fork-handlers` and the `paychecks` guard message (modified requirement "Editing and deleting paychecks"). Verify with `openspec validate fork-mcp-server --strict`.
- [x] 1.2 Add failing tests in `packages/api/methods.test.ts`, named after the scenarios: "A script edits a paycheck", "Move on budget through the API", "Errors are the handler's errors" and "A handler without a method" (compare the fork-only handlers, found from `app.method` registrations including multi-line ones, with the exports of `methods.ts`).
- [x] 1.3 Add the 14 typed methods in `packages/api/methods.ts` as thin `send(...)` wrappers with types from `Handlers`; export them from `index.ts`; refresh the API type snapshots.
- [x] 1.4 Let the CLI use them only if a command already needs one; add no commands in this slice.

## 2. `packages/mcp` skeleton and read-only core tools (sc-1569)

- [x] 2.1 Spec requirements "Local stdio only" to "Results are capped" (core tools part). Verify with `openspec validate fork-mcp-server --strict`.
- [x] 2.2 Scaffold `packages/mcp` (`@actual-app/mcp`, vite build, `tsgo` typecheck, project references, `bin/actual-mcp`), patterned on `packages/cli`. The version matches the other packages. It is not yet in the aligned set (group 6).
- [x] 2.3 Add the fixture-budget builder (a temp data directory seeded through the real API, no server) and failing tests named after the scenarios: "No listener", "A secret on argv", "A failed sign-in", "Production is refused by default", "Production is read-only even when allowed", "A look-alike host", "Directory mode", "A loose directory", "Reads only by default", "Transactions from a fixture budget", "A query that is not a select", "An injected note", "A long field", "A URL in a note", "Limit above the maximum" and "Large rows".
- [x] 2.4 Implement `config` (environment, allowlist, labels), `connection` (init, download, load, shutdown), `sanitize`, `paging` and the core read tools.
- [x] 2.5 Security Analyst approves the PR (credentials, allowlist, injection hygiene).

## 3. Coverage manifest and CI check (sc-1570)

- [x] 3.1 Spec requirement "Coverage manifest" (already in this change; confirm). Verify with `openspec validate fork-mcp-server --strict`.
- [x] 3.2 Add `fork/scripts/check-mcp-coverage.test.mjs` with the scenarios "A new handler without coverage", "A deliberate skip", "A registration across lines" and "Skip without a reason".
- [x] 3.3 Add `fork/scripts/check-mcp-coverage.mjs`, `packages/mcp/coverage.json` and `upstream-handlers.json` (from `upstream/master`), the `check:mcp-coverage` script and the `fork-ci.yml` step. The check also fails on a fork handler outside the baseline with no `send('<handler>'` in `packages/api/methods.ts` and no skip reason. Record the fork-only handlers as mapped to the tools of groups 2 and 4, or as skips with reasons.
- [x] 3.4 Add the manifest line to the story-template checklist in `docs/agents/issue-tracker.md`, and note it in `docs/agents/team.md` if reviewers need it.

## 4. Fork read tools (sc-1571)

- [x] 4.1 Spec "Fork read tools". Verify with `openspec validate fork-mcp-server --strict`.
- [x] 4.2 Add failing tests: "Year to date", "Moved history" and "A preview changes nothing", plus one per remaining fork read tool (paychecks, clearing status, business calendars, schedule next dates with a relative date, account budget status).
- [x] 4.3 Implement the tools over the typed methods of group 1 and the shared `isMovedHistory` helper. Update `coverage.json`.

## 5. Opt-in write tools with an audit log (sc-1572)

- [x] 5.1 Spec "Write tools", "Moving on budget needs the preview" and "Write audit log". Verify with `openspec validate fork-mcp-server --strict`.
- [x] 5.2 Add failing tests against the fixture budget: "Over the row limit", "Before and after", "A name where an id is required", "No destructive tools", "Confirm matches", "A stale confirm", "A write is logged", "The log can't be written", "Writes on a separate entry".
- [x] 5.3 Implement the `--writes` entry, the five `write_` tools, `confirm` digests and the audit log (log first, then write). Update `coverage.json`.
- [ ] 5.4 Security Analyst approves the PR; the Tester runs the writes against staging only.
- [x] 5.5 Spec "Moved history is not categorized by a write"; add failing tests named after its five scenarios, then refuse (before the audit append) any write that would categorize moved history, using the shared `isMovedHistory`.

## 6. Eighth aligned package (sc-1573)

- [x] 6.1 Spec "An aligned release package". Verify with `openspec validate fork-mcp-server --strict`.
- [x] 6.2 Add failing tests: "Versions drift" (a script or vitest test comparing the eight `package.json` versions) and "The server reports its version".
- [x] 6.3 Join `@actual-app/mcp` to the version bumps: update the "Private customized build versions" rule in `AGENTS.md`, the bump process and `actual-hosting` steps; add the build artifact to `fork-build.yml`; write `docs` for setting up the server with `op run`.
- [ ] 6.4 Release note and fork news for the version that first carries the package (`fork/release-notes/<buildVersion>.md`, `yarn generate:fork-news`).
- [ ] 6.5 Archive this change when its last story merges (task 7.4 if sc-1637 is later than sc-1573), update the #1550 row in the epic table of `docs/agents/issue-tracker.md` with `mcp-server` and `api-fork-handlers`, and file Backlog stories for any open follow-ups.

## 7. Coverage check finds `handlers[...]` registrations (sc-1637)

- [x] 7.1 Spec "Registration forms" and the reworded "Coverage manifest" (in this change). Verify with `openspec validate fork-mcp-server --strict`.
- [x] 7.2 Add failing tests in `fork/scripts/check-mcp-coverage.test.mjs`, named after the scenarios: "An assigned handler without coverage", "An assigned handler with an entry", "An assigned handler across lines", "A call is not a registration" (a call, a `===` comparison and an argument) and, for the baseline, a test that the rebuilt file lists an assigned upstream handler.
- [x] 7.3 Add the `handlers[...] =` pattern to the extractor (whole-file, `=` not `==`, `=>` or a call), rebuild `packages/mcp/upstream-handlers.json` with `--baseline-from upstream/master` (an upstream ref only; review the diff), and map or skip any fork-only handlers it finds, with reasons (none found when this was written).
- [ ] 7.4 Archive this change when its last story merges (task 13.4 now); otherwise do it in 6.5.

## 8. Read-tool hardening (sc-1664)

- [x] 8.1 Spec requirements "Paycheck definition text is data", "The move preview pages its transfers" and "Next-date search is bounded". Verify with `openspec validate fork-mcp-server --strict`.
- [x] 8.2 Add failing tests named after the scenarios: "An injected deposit kind", "A hostile deposit id", "A hostile account id", "Clearing status ids are checked too", "A normal deposit is unchanged", "More transfers than one page", "The digest covers every page", "A transfer on a later page changes", "A rule that never matches" (with a time bound) and "A malformed rule is still an error".
- [x] 8.3 Map `kind` onto the three values or `unknown` and sanitize every id field read from the definition (clearing account, payee, income category, pay schedule, and each deposit's id, account and schedule) in `list_paychecks` and `get_paychecks_clearing_status`; page `transfers` with a whole-preview `confirm`; catch the recurrence library's "Failed to find a matching occurrence" error and return the "No matching date" result, with a test that pins the message prefix.
- [x] 8.4 Move `@actual-app/core` to `devDependencies` in `packages/mcp/package.json`, and make the `mcp-build` job fail if `dist/mcp.js` imports it.
- [x] 8.5 Update `coverage.json` and the README for any changed tool output. Security Analyst approves the PR.

## 9. Write-tool hardening (sc-1684)

- [x] 9.1 Spec requirements "Write outcomes are logged", "Multi-row updates stop at the first failure" and "Write amounts and dates are bounded". Verify with `openspec validate fork-mcp-server --strict`.
- [x] 9.2 Add failing tests named after the scenarios: "A create's outcome line", "A failed write's outcome line", "The outcome line can't be written", "A failure partway", "An extreme amount", "An impossible date" and "An impossible month".
- [x] 9.3 Add the call id, the outcome line and `audit_outcome` to the write tools and `appendAudit`; make `write_update_transactions` stop at the first failure and report applied and failed rows; add the amount, date and month bounds with fixed refusal text before the attempt line.
- [x] 9.4 Update the README and the docs page for the outcome line and the bounds. Security Analyst approves the PR.
- [ ] 9.5 Archive this change when its last story merges (task 13.4 now), update the #1550 row in the epic table of `docs/agents/issue-tracker.md` with `mcp-server`, `api-fork-handlers` and `api-read-only-mode`, and file Backlog stories for any open follow-up (for example a public batch update method, if partial failures are seen).

## 10. A push-free read mode (sc-1601)

- [x] 10.1 Spec capability `api-read-only-mode` and, in `mcp-server`, the scenarios "A read entry writes nothing" and "The writes entry runs the engine normally" (replacing "A sync has the app's side effects"). Verify with `openspec validate fork-mcp-server --strict`.
- [x] 10.2 Add failing tests named after the scenarios. Engine (loot-core, mock sync server): "A read-only session posts nothing" and "A normal session still posts" (a due auto-post schedule; the first run is red with the flag off because it posts and the server's messages grow), "A read-only session does not reconcile paycheck edits" and "A read-only session uploads no budget file", "A normal session still uploads", "A read-only session sends no repair messages" and "A read-only session still pulls". MCP: a wiring test that `openBudget` passes `readOnly: true` unless `--writes`.
- [x] 10.3 Add `readOnly` to `InitConfig` and the engine flag; guard `runTrackedMutator`, the schedules `sync` handler (no run, no `lastScheduleRun`), `possiblyUpload` (return early) and `syncMigrations.listen()` (register nothing); pass `readOnly` from the MCP read entry.
- [x] 10.4 Remove the side-effect wording from `packages/mcp/README.md` ("Sync side effects"), `packages/docs/docs/api/mcp-server.md` ("Notes on Syncing") and the `sync_budget` description in `tools/read/core.ts`, and document `readOnly` in the API reference.
- [ ] 10.5 Check every caller of `sendMessages` and, if it is safe, file a Backlog story for the optional throw-in-read-only backstop; do not build it here. Security Analyst approves the PR.
- [ ] 10.6 Archive this change when its last story merges (task 13.4 now), and add `api-read-only-mode` to the #1550 row in the epic table of `docs/agents/issue-tracker.md`.

## 11. Paging `get_budget_month` (sc-1912)

- [ ] 11.1 Spec requirement "Budget months are paged". Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 11.2 Add failing tests named after the scenarios: "A month larger than one page" (120 categories in 6 groups, including a group that straddles a page boundary), "A small month is one page" and "A malformed cursor".
- [ ] 11.3 Page the categories in `get_budget_month` with the shared paging helpers, return the whole-month totals and `category_count` on every page, group the page's categories under their groups, and update the tool description, README and `coverage.json` if needed. Security Analyst approves the PR.

## 12. Checking the data directory before creating it (sc-1913)

- [ ] 12.1 Spec requirement "The data directory is checked before it is created". Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 12.2 Add failing tests named after the scenarios, using a temporary home: "A refused directory is not created" (nothing exists afterwards, including missing parents), "A symlinked parent is checked" and "An allowed directory is created private".
- [ ] 12.3 In `ensurePrivateDir`, resolve the nearest existing ancestor's real path, check it with the remaining path before any `mkdir`, create with mode 0700 only after the check, and re-check after creating, removing only what this call created on a failure (design Decision 16). Security Analyst approves the PR.

## 13. The `--writes` entry has its own data directory (sc-1948)

- [ ] 13.1 Spec requirement "The writes entry has its own data directory" (already in this change), and design Decision 17. Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 13.2 Add failing tests named after the scenarios: "The entries use separate data directories" (a config test for both defaults and the audit log names) and "A write session's unsent message stays out of a read session".
- [ ] 13.3 Give the `--writes` entry its own `<env>-writes` data directory and audit log (`<env>-writes.audit.jsonl`), with a README and docs line telling anyone who used the read directory for a write session before this change to delete it once. Security Analyst approves the PR.
- [ ] 13.4 Archive this change when its last story merges, update the #1550 row in the epic table of `docs/agents/issue-tracker.md` with `mcp-server`, `api-fork-handlers` and `api-read-only-mode`, and file Backlog stories for any open follow-up (a public batch update method if partial failures are seen, and the `sendMessages` backstop for read-only mode after every caller is checked).
