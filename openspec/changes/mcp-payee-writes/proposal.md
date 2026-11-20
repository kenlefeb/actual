# Proposal

## Why

Story sc-5521, in epic 1550, from the review of `mcp-schedule-writes` (design Q4). Ken's loan lender may not be a payee yet. `write_create_schedule` takes a payee id, so his client cannot add a loan payment schedule for a new lender until he adds the payee in the app. Ken's rule is that the MCP does everything he can do in the app, limited by permissions and not by missing tools. He decided to build this before the next release.

## What Changes

- **One tool, `write_create_payee`** (`structure:write`, which the spec already says covers payees).
  - Input: `name` (trimmed, 1 to 100 characters) and `dry_run`.
  - Output: `payee_id`, `name` and `created`.
  - A name that matches a live payee ignoring case returns that payee with `created: false` and writes nothing.
  - A name that matches a transfer payee ("Transfer: ...") is refused.
  - It calls the same engine payee creation as the app, through `api.createPayee`.
  - It is audit-logged and undoable: `write_undo` deletes the payee while it is unused and unchanged.
- **No new scope and no new limit.** The grant needs only `structure:write`, which the category tools already need (design D4).

Mobile scope: none. MCP tools have no UI.

Not in this change: renaming, deleting or merging payees (`api/payee-update`, `api/payee-delete`, `api/payees-merge`), payee rules and locations. They keep their coverage skips and need their own stories.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-server`: one ADDED requirement set for `write_create_payee`, its duplicate rule, dry run, undo and coverage.

## Impact

- **MCP code:** `packages/mcp/src/tools/write/payees.ts` (new); `declarations.ts` (undo table); `undo.ts` (one planner); `coverage.json`, `README.md` and tests.
- **API and loot-core:** none.
- **Production:** Ken's grant row for `claude-production` must already list `structure:write` (category tools need it); if it does not, add that one line. Nothing else is new.
- **Reviews:** Architect and Product Owner.
