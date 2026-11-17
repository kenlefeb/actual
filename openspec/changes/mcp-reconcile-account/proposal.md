# Proposal

## Why

Story sc-4213 (Integrations, epic 1550; part of sc-4203): Claude compared Ken's accounts with the bank and got three matching to the cent, but the MCP cannot lock the matched rows or record the balance, so the next run cannot tell which rows are proven. The app's Reconcile does both, entirely in the client; the server has no reconcile handler.

Part B (unlock, undo of reconcile, a `through_date` filter) is its own story, filed by the Product Owner. This change is part A only.

## What Changes

- **`write_reconcile_account`** (`transactions:write`): takes an account and a statement balance in cents, computes the cleared balance and the difference as the app does, and when the difference is zero locks the cleared, unreconciled rows and stamps the account's `last_reconciled`. A non-zero difference writes nothing and reports the difference. It never creates the "Reconciliation balance adjustment" row.
- **Dry run and confirm:** the tool is destructive for `loggedWrite`, so under `confirm_destructive` the first call returns the rows it would lock, the cleared balance and the difference with a `confirm` bound to them; the write recomputes and must match.
- **Reads:** transaction reads return `reconciled`; a new read tool returns an account's cleared balance, its count of cleared unreconciled rows and `last_reconciled`.
- **`max_reconcile_rows`:** a configurable limit of its own (default 500, operator ceiling 2,000, grant override), because locking flips a flag and `max_rows` (10 in production) is sized for content edits. It is part of the audit-tail startup check.
- **Audit:** one `reconciled` change per row and a `last_reconciled` change, schema 2.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

Not in this change (part B, own story): `write_unlock_transactions`, undo of a reconcile, `through_date`. Not planned: auto-creating the adjustment row (Claude uses `write_create_transactions` on the user's say-so, so it is visible and audited).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Reconcile an account", "Reconciliation reads", "Reconciling has its own row limit" and "A reconcile is audited". Additions only: the active change `mcp-budget-maintenance` modifies "Write limits" and the grant requirements, and this change leaves those texts alone so the two archive in either order.

## Impact

- **Code:** new `packages/mcp/src/tools/write/reconcile.ts`; `shared.ts` (`requireReconcileRows`), `limits.ts`, `grants.ts`, `config.ts` (the limit, its ceiling, the grant key, the tail check); `update-plan.ts` or a small plan helper for the lock with split children; the read tools (`reconciled`, cleared balance); typed `updateAccount` field `last_reconciled`; tests, `coverage.json`, `README.md`.
- **api-fork-handlers:** none expected (design D4). If the first failing test shows `api/account-update` drops `last_reconciled`, add one handler and a delta then.
- **Hosting (own story after the image ships):** pass the new setting names and the grant key through, as for `max_cells`.
- **Reviews:** Tester; Solution Architect; Security Analyst (a bulk flag write behind a confirm); Product Owner reviews intent.
