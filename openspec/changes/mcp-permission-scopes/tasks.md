# Tasks

## 1. Scopes and enforcement in the wrapper (sc-4477)

- [ ] 1.1 Add the scope list and a `Grant` type (scopes, `confirm_destructive`, `max_rows`) in `packages/mcp/src`, with a test that rejects an unknown scope name
- [ ] 1.2 Extend `register` in `server.ts` to take `{ scopes, destructive }`, check the grant before `fn`, throw the fixed refusal text, append `Needs: …` to the description and set `readOnlyHint` / `destructiveHint`; register every tool on every entry. Verify with failing-first tests: one allowed and one refused call per scope, and a refusal is not "unknown tool"
- [ ] 1.3 Declare scopes on every existing read and write tool, per the "Today's write tools" scenario; add a test that fails when any registered tool has no declared scope
- [ ] 1.4 Append a `refused` audit line (time, identity, tool, missing, granted; no arguments) before refusing, best effort; pass the audit path to the read stdio entry (`<env>.audit.jsonl`). Verify with the "A refused write leaves a line" scenario test
- [ ] 1.5 Add `scopes` (and on the hosted entry `grant`) to attempt and outcome lines in `audit.ts`; verify with the updated "An audit line names its identity" test

## 2. Grants for each entry (sc-4477)

- [ ] 2.1 Stdio: in `config.ts`, the `--writes` entry reads `ACTUAL_MCP_WRITES_SCOPES`, `ACTUAL_MCP_WRITES_CONFIRM_DESTRUCTIVE` and `ACTUAL_MCP_WRITES_MAX_ROWS` with the defaults from design D4 and fails at start for an unknown scope; the read entry ignores them and grants `budget:read`. Verify with `config.test.ts` cases for each scenario of "Stdio grants come from the environment", including the shared env file
- [ ] 2.2 Hosted: read `ACTUAL_MCP_GRANTS_FILE` in `remote-config.ts`; add a grants loader per design D3: `lstat` (no symlink), file and directory not writable, reuse on unchanged mtime, size and inode, otherwise one `open`, `fstat`, read and hash from that descriptor; strict schema validation (version, unknown keys, known non-empty scopes, positive `max_rows`, boolean confirm, no wildcard subject, no duplicate pair, `*` read-only); hosted `confirm_destructive` defaults to true; match exact client before `*`; fail closed to `budget:read`, logging each new reason once. Verify with tests for each scenario of "Hosted grants come from a grants file", "The grants file schema is strict", "Hosted confirm is on by default" and "Hosted grants fail closed"
- [ ] 2.3 Pass the per-call grant from `remote.ts` into `createServer`; keep the token scope `budget:read`. Verify with `remote.writes.test.ts`: an existing `budget:read` token gains a write after the grant changes, and loses it after removal, with no restart

## 3. Safeguards as grant options (sc-4477)

- [ ] 3.1 Generic dry run in `loggedWrite`: for destructive tools with `confirm_destructive`, return `{ dry_run, ids, changes, confirm }` without writing; accept `confirm` (issued-at plus HMAC over issued-at, subject, client, tool, args and entry, per-process key; 5-minute lifetime), compare in constant time, and refuse a mismatch or expiry with fixed text. Add the optional `confirm` input to `write_delete_category` and `write_delete_category_group`. Verify with the "Dry run then confirm", "A stale confirm" and "An expired confirm" scenario tests, plus a confirm from another client being refused
- [ ] 3.2 Replace the fixed `MAX_WRITE_ROWS` check with `min(grant.max_rows ?? 50, 50)`; verify with the "Lowered cap" test and the existing 51-row test

## 4. Documentation and hosting rollout (sc-4477)

- [ ] 4.1 Update `packages/mcp/README.md`: scopes table, grants file format and schema, the stdio `ACTUAL_MCP_WRITES_*` variables (read by the writes entry only), the note that the stdio grant is a guard rail and not a boundary, that per-client grants do not separate agents sharing one sign-in, refusal text, confirm (mistakes only, 5 minutes, caller-bound) and row-cap options, and the migration notes. Verify every variable named in the README exists in `config.ts` or `remote-config.ts`
- [ ] 4.2 `kenlefeb/actual-hosting` PR: mount `{{mcp_root}}/grants:/run/mcp-grants:ro`, set `ACTUAL_MCP_GRANTS_FILE` in both MCP compose templates, commit the staging and production `grants.json` (production = Ken's day-one grant: every scope except `delete`, `confirm_destructive` true, `max_rows` 10, on the pre-registered client id; `*` holds `budget:read`), and install them from `deploy-command.py` with the same schema validation. Verify the staging deploy installs the file root-owned 0644 in a root-owned directory, and that a staging write succeeds and a scope removed from the staging file is refused on the next call
- [ ] 4.3 `kenlefeb/actual-hosting` CI: a schema check of both `grants.json` files that fails on an unknown key or scope, a duplicate (subject, client) pair or writes on `*`. Verify with a CI run on a deliberately bad fixture
- [ ] 4.4 `docs/agents/team.md`: add the MCP grants files (`production/mcp/grants.json` and the staging copy) to the Security Analyst's row of the review matrix. Verify the row names them
- [ ] 4.5 Run `yarn typecheck`, `yarn lint` and `yarn workspace @actual-app/mcp run test` and `yarn check:mcp-coverage`; all pass

## Workflow follow-up

- Archive `mcp-remote-read-write` before archiving this change.
- The Security Analyst reviews the model before it ships (sc-4477).
- When undo (sc-4215) ships, a hosting PR may add `delete` to the production grant (Ken's day-one decision).
- At archive, update the `mcp-server` Purpose line: write tools are listed on every entry and a grant decides which calls succeed.
- After archiving, file a Backlog story for a grants-only deploy mode in `actual-hosting` (design D3; same signed approval and validation) and one for a grants editor UI, or mark them not planned.
