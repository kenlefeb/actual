# Tasks

## 1. Typed API methods (sc-1568)

- [ ] 1.1 Spec `api-fork-handlers`. Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 1.2 Add failing tests in `packages/api/methods.test.ts`, named after the scenarios: "A script edits a paycheck", "Move on budget through the API", "Errors are the handler's errors" and "A handler without a method" (compare the fork-only handlers, found from `app.method` registrations including multi-line ones, with the exports of `methods.ts`).
- [ ] 1.3 Add the 14 typed methods in `packages/api/methods.ts` as thin `send(...)` wrappers with types from `Handlers`; export them from `index.ts`; refresh the API type snapshots.
- [ ] 1.4 Let the CLI use them only if a command already needs one; add no commands in this slice.

## 2. `packages/mcp` skeleton and read-only core tools (sc-1569)

- [ ] 2.1 Spec requirements "Local stdio only" to "Results are capped" (core tools part). Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 2.2 Scaffold `packages/mcp` (`@actual-app/mcp`, vite build, `tsgo` typecheck, project references, `bin/actual-mcp`), patterned on `packages/cli`. The version matches the other packages. It is not yet in the aligned set (group 6).
- [ ] 2.3 Add the fixture-budget builder (a temp data directory seeded through the real API, no server) and failing tests named after the scenarios: "No listener", "A secret on argv", "A failed sign-in", "Production is refused by default", "Production is read-only even when allowed", "A look-alike host", "Directory mode", "A loose directory", "Reads only by default", "Transactions from a fixture budget", "A query that is not a select", "An injected note", "A long field", "A URL in a note", "Limit above the maximum" and "Large rows".
- [ ] 2.4 Implement `config` (environment, allowlist, labels), `connection` (init, download, load, shutdown), `sanitize`, `paging` and the core read tools.
- [ ] 2.5 Security Analyst approves the PR (credentials, allowlist, injection hygiene).

## 3. Coverage manifest and CI check (sc-1570)

- [ ] 3.1 Spec requirement "Coverage manifest" (already in this change; confirm). Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 3.2 Add `fork/scripts/check-mcp-coverage.test.mjs` with the scenarios "A new handler without coverage", "A deliberate skip", "A registration across lines" and "Skip without a reason".
- [ ] 3.3 Add `fork/scripts/check-mcp-coverage.mjs`, `packages/mcp/coverage.json` and `upstream-handlers.json` (from `upstream/master`), the `check:mcp-coverage` script and the `fork-ci.yml` step. Record the fork-only handlers as mapped to the tools of groups 2 and 4, or as skips with reasons.
- [ ] 3.4 Add the manifest line to the story-template checklist in `docs/agents/issue-tracker.md`, and note it in `docs/agents/team.md` if reviewers need it.

## 4. Fork read tools (sc-1571)

- [ ] 4.1 Spec "Fork read tools". Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 4.2 Add failing tests: "Year to date", "Moved history" and "A preview changes nothing", plus one per remaining fork read tool (paychecks, clearing status, business calendars, schedule next dates with a relative date, account budget status).
- [ ] 4.3 Implement the tools over the typed methods of group 1 and the shared `isMovedHistory` helper. Update `coverage.json`.

## 5. Opt-in write tools with an audit log (sc-1572)

- [ ] 5.1 Spec "Write tools", "Moving on budget needs the preview" and "Write audit log". Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 5.2 Add failing tests against the fixture budget: "Over the row limit", "Before and after", "A name where an id is required", "No destructive tools", "Confirm matches", "A stale confirm", "A write is logged", "The log can't be written", "Writes on a separate entry".
- [ ] 5.3 Implement the `--writes` entry, the five `write_` tools, `confirm` digests and the audit log (log first, then write). Update `coverage.json`.
- [ ] 5.4 Security Analyst approves the PR; the Tester runs the writes against staging only.

## 6. Eighth aligned package (sc-1573)

- [ ] 6.1 Spec "An aligned release package". Verify with `openspec validate fork-mcp-server --strict`.
- [ ] 6.2 Add failing tests: "Versions drift" (a script or vitest test comparing the eight `package.json` versions) and "The server reports its version".
- [ ] 6.3 Join `@actual-app/mcp` to the version bumps: update the "Private customized build versions" rule in `AGENTS.md`, the bump process and `actual-hosting` steps; add the build artifact to `fork-build.yml`; write `docs` for setting up the server with `op run`.
- [ ] 6.4 Release note and fork news for the version that first carries the package (`fork/release-notes/<buildVersion>.md`, `yarn generate:fork-news`).
- [ ] 6.5 Archive this change when sc-1573 merges (the last story), update the #1550 row in the epic table of `docs/agents/issue-tracker.md` with `mcp-server` and `api-fork-handlers`, and file Backlog stories for any open follow-ups.
