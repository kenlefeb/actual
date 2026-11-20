# Tasks

**Tests first:** for every task, write the tests, see them fail, then write the code. Say in the PR which tests failed first.

## 1. `write_create_payee` (sc-5521)

- [ ] 1.1 `write_create_payee` in `tools/write/payees.ts` (`structure:write`). Failing tests first:
  - a new name creates one payee, returns `payee_id`, `name` and `created: true`, and `list_payees` shows it;
  - the stored payee equals the one the app's `payee-create` makes;
  - the name is trimmed; an empty or over-long name is refused;
  - an existing name ignoring case returns the existing id with `created: false`, writes no row and no audit line;
  - a transfer payee's name is refused.
- [ ] 1.2 `dry_run`. Failing tests first: it reports `created` and the existing id if any; it writes no payee and no audit line.
- [ ] 1.3 Audit and undo: `write_create_payee` in the `UNDOABLE` table (`structure:write`) and a planner in `undo.ts`. Failing tests first: attempt and outcome lines with the created id; undo removes an unused payee; undo is refused when a transaction, schedule or rule uses it, when the name changed, and the second time.
- [ ] 1.4 Scope and engine tests: refused without `structure:write`, naming it; the description names the scope and ends with "write_undo reverses it."; with `internal()` mocked to null the call is refused with fixed text and no audit line.
- [ ] 1.5 `coverage.json` lines for `payee-create` and `createPayee`, and the `README.md` tool list; `yarn check:mcp-coverage` passes.
- [ ] 1.6 Built-artifact check (design D5): run `yarn build:mcp`, then the built `dist/mcp.js` against a fixture budget: create, list, create again, undo. Record the result in the PR.
