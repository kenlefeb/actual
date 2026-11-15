# Tasks

## 1. Scopes and enforcement in the wrapper (sc-4477)

- [ ] 1.1 Add the scope list and a `Grant` type (scopes, `confirm_destructive`, `max_rows`) in `packages/mcp/src`, with a test that rejects an unknown scope name
- [ ] 1.2 Extend `register` in `server.ts` to take `{ scopes, destructive }`, check the grant before `fn`, throw the fixed refusal text, append `Needs: …` to the description and set `readOnlyHint` / `destructiveHint`; register every tool on every entry. Verify with failing-first tests: one allowed and one refused call per scope, and a refusal is not "unknown tool"
- [ ] 1.3 Declare scopes on every existing read and write tool, per the "Today's write tools" scenario; add a test that fails when any registered tool has no declared scope
- [ ] 1.4 Append a `refused` audit line (time, identity, tool, missing, granted; no arguments) before refusing, best effort; pass the audit path to the read stdio entry (`<env>.audit.jsonl`). Verify with the "A refused write leaves a line" scenario test
- [ ] 1.5 Add `scopes` (and on the hosted entry `grant`) to attempt and outcome lines in `audit.ts`; verify with the updated "An audit line names its identity" test

## 2. Grants for each entry (sc-4477)

- [ ] 2.1 Stdio: read `ACTUAL_MCP_SCOPES`, `ACTUAL_MCP_CONFIRM_DESTRUCTIVE` and `ACTUAL_MCP_MAX_ROWS` in `config.ts` with the defaults from design D4; fail at start for an unknown scope or a write scope without `--writes`. Verify with `config.test.ts` cases for each scenario of "Stdio grants come from the environment"
- [ ] 2.2 Hosted: read `ACTUAL_MCP_GRANTS_FILE` in `remote-config.ts`; add a grants loader that stats the file every call, reparses on an mtime, size or inode change, matches subject plus client (exact before `*`), and fails closed (missing, unparseable, unknown scope, writable by the process). Verify with tests for each scenario of "Hosted grants come from a grants file" and "Hosted grants fail closed"
- [ ] 2.3 Pass the per-call grant from `remote.ts` into `createServer`; keep the token scope `budget:read`. Verify with `remote.writes.test.ts`: an existing `budget:read` token gains a write after the grant changes, and loses it after removal, with no restart

## 3. Safeguards as grant options (sc-4477)

- [ ] 3.1 Generic dry run in `loggedWrite`: for destructive tools with `confirm_destructive`, return `{ dry_run, ids, changes, confirm }` without writing; accept `confirm` (HMAC over tool, args and entry, per-process key), compare in constant time, and refuse a mismatch with fixed text. Add the optional `confirm` input to `write_delete_category` and `write_delete_category_group`. Verify with the "Dry run then confirm" and "A stale confirm" scenario tests
- [ ] 3.2 Replace the fixed `MAX_WRITE_ROWS` check with `min(grant.max_rows ?? 50, 50)`; verify with the "Lowered cap" test and the existing 51-row test

## 4. Documentation and hosting rollout (sc-4477)

- [ ] 4.1 Update `packages/mcp/README.md`: scopes table, grants file format, stdio variables, refusal text, confirm and row-cap options, and the migration notes. Verify every variable named in the README exists in `config.ts` or `remote-config.ts`
- [ ] 4.2 `kenlefeb/actual-hosting` PR: mount `{{mcp_root}}/grants:/run/mcp-grants:ro`, set `ACTUAL_MCP_GRANTS_FILE` in both MCP compose templates, commit the staging and production `grants.json` (production = Ken's confirmed day-one grant), and install them from `deploy-command.py`. Verify the staging deploy installs the file root-owned 0644, and that a staging write succeeds and a scope removed from the staging file is refused on the next call
- [ ] 4.3 Run `yarn typecheck`, `yarn lint` and `yarn workspace @actual-app/mcp run test` and `yarn check:mcp-coverage`; all pass

## Workflow follow-up

- Archive `mcp-remote-read-write` before archiving this change.
- The Security Analyst reviews the model before it ships (sc-4477).
- Ken confirms the day-one production grant before the production promotion.
- After archiving, file a Backlog story for a grants-only deploy mode in `actual-hosting` (design D3) and one for a grants editor UI, or mark them not planned.
