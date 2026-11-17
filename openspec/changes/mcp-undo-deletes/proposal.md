# Proposal

## Why

Story sc-4692 (Undo C, the third part of sc-4203 after sc-4215): `write_undo` cannot reverse a delete, and Ken keeps `delete` out of the production grant (sc-4541) until it can. Story sc-4485: agents cannot delete a transaction at all; Ken deleted 15 by hand in the 2026-11-13 cleanup. The delete tool is group 1 here so it logs what its undo needs from its first release.

The Architect's Explore (sc-4692 comment 4913) found that every delete in scope is a soft delete in loot-core: `db.delete_` sets `tombstone = 1`, a category delete leaves its transactions on the old id behind `category_mapping`, and the app's own undo restores deletes by setting `tombstone = 0`. So undo can bring back the original rows with their original ids, instead of re-creating them with new ids and remapping.

## What Changes

- **`write_delete_transactions`** (`transactions:write`, `delete`; sc-4485): deletes transactions by id, a split parent with its children, a transfer with its partner as the app does; refuses split children and, without the override, reconciled rows; dry run and `confirm` under `confirm_destructive`; counted against the delete limit.
- **Delete audit lines carry what undo needs**: transaction, category and group deletes log every id they tombstone, the mapping rows and transfer partner fields they change, and the transfer category's budget cells before and after. Ids and values only.
- **A delete must be undoable**: a delete whose undo record would not fit the audit line limit or the cell limit is refused before any audit line. No new limit.
- **`write_undo` reverses deletes** of transactions, categories and category groups by restoring the original rows, through a new fork handler, and puts the transfer category's budget cells back. It refuses the whole undo on any conflict.
- **Fork handler `undelete-rows`** with a typed `@actual-app/api` method `undeleteRows`: resets `tombstone` and a few allowlisted columns for named ids of allowlisted tables, in one batch, without rules or transfer hooks.

Mobile scope: none. The MCP server and the API have no UI, so this change is exempt from the desktop and mobile rule.

Not in this change: account close and delete (sc-4695, not undoable by design); moves and paycheck skip (sc-4691); skipping a schedule occurrence when a scheduled row is deleted (sc-4266); the production grant change (sc-4541).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Delete transactions", "Transaction delete refusals", "Deletes log what their undo needs", "A delete must be undoable", "Undo of a delete restores the original rows" and "Undo of a delete refuses on any conflict"; "What undo reverses" is modified.
- `api-fork-handlers`: new requirement "Undelete rows".

## Impact

- **Code:** `packages/loot-core/src/server/api.ts` (one fork handler) and its types, `packages/api/methods.ts`, `packages/mcp/src/tools/write/transactions.ts` (new tool), `categories.ts` (snapshot), `undo.ts` (three planners, scope table), `shared.ts` if the size check is shared, tests, `packages/mcp/coverage.json` (the handler and the delete tool), `packages/mcp/README.md`.
- **Reviews:** Tester; Solution Architect; Security Analyst for both groups (deleting by id; restoring rows from a log line); the Product Owner reviews intent.
- **Ordering:** group 1 (sc-4485) merges first; group 2 (sc-4692) undoes its lines. Both must ship before sc-4541.

## Decisions for Ken

None.
