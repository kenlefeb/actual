# Design

## Facts

Read from the code on `development` (2026-11-20).

- **Engine.** `api.createPayee({ name })` sends `api/payee-create`, which calls the app's `payee-create`: `db.insertPayee` inserts the payee and its `payee_mapping` row in one batch. It does not trim, refuse a duplicate or check for a transfer payee.
- **Reads and deletes.** `api.getPayees()` returns live payees, transfer payees included (`transfer_acct` set; their names are "Transfer: <account>"). `api.deletePayee(id)` silently ignores a transfer payee.
- **MCP.** `list_payees` (`budget:read`) lists id and name. There is no payee write tool. `write_create_category` is the pattern: `loggedWrite`, created id on the outcome line, `UNDOABLE` entry, a planner in `undo.ts` that deletes while unused. `structure:write` already covers "accounts, categories, payees, tags, rules" in the spec.
- **Missing engine.** The schedules build added `requireEngine()` because its tools call `internal().send` for handlers the API lacks, and the API's CJS build can hide `internal`. This tool uses only the public API (`createPayee`, `getPayees`, `deletePayee`); the budget-id read every write does already refuses with fixed text when the engine is not loaded.

## D1. The tool

`write_create_payee { name, dry_run? }` (`structure:write`):
1. Trim `name`; refuse empty or over 100 characters (fixed text, nothing changed).
2. Read `getPayees()`. A live payee whose name equals it ignoring case: if it is a transfer payee, refuse; otherwise return it with `created: false`, write nothing and log nothing.
3. Otherwise `loggedWrite` calls `api.createPayee`, logging one change (`name`, before null, after the name) and the created id on the outcome line, and returns `{ payee_id, name, created: true }`.

**Duplicates: return the existing id (recommended), not a refusal.** A client retrying after a timeout, or one that does not know the lender exists, gets what it wanted, the payee id, and never a second row. A refusal would make it parse an error to find the id. The result says `created: false`, so the client knows nothing was written.

`dry_run: true` returns `{ dry_run: true, created: <would be>, payee_id: <existing id or null>, name }` and writes nothing, not even an audit line. It needs no `confirm`: a create is not destructive.

## D2. Undo

`write_undo` reverses a create by deleting the payee (`api.deletePayee`), as the category planner does. It refuses, changing nothing, when the payee's name differs from the logged one, or when it is used: a transaction names it, a schedule names it, or a rule refers to its id (the same id-text scan the category planner uses). A write is undone once. Under `confirm_destructive`, undoing a create returns a dry run with a `confirm`, as today. A `created: false` call wrote nothing and has no line to undo.

## D3. Limits

No new setting. One payee per call. The 100-character name bound is a fixed input-shape limit, like the `id` (100) and notes (1000) bounds and the category name bound, not an operator cap. Story sc-5521 calls it "the payee-name length setting"; there is none today (Q1).

## D4. Scope and the production grant

`structure:write` only: payees are already named under it and creating one is not a delete. Ken's grant row (the server file named by `ACTUAL_MCP_GRANTS_FILE`, client `claude-production`) must list `"structure:write"`. The category tools need it too, so it is probably there; check. Nothing new otherwise.

## D5. Coverage and the built artifact

`coverage.json` maps `payee-create` and `createPayee` to `write_create_payee`; `yarn check:mcp-coverage` passes with a test naming the tool. The other payee handlers keep their skips. Because the shipped server is a built ESM bundle over the CJS API, the last task runs the built `dist/mcp.js` once (after `yarn build:mcp`) against a fixture budget: create a payee, list it, create the same name again (`created: false`), undo.

## Questions

- **Q1 (Architect).** Keep the name bound fixed at 100 (recommended, as categories), or add a payee-name limit to `limits.ts` with a default? Ken's rule says caps are settings; this is a shape bound, so I treat it as the existing exception.
- **Q2 (Product Owner).** Payee rename, delete and merge are still app-only. File them as separate stories if Ken wants full parity.
