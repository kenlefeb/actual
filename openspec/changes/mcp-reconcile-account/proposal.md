# Proposal

## Why

Story sc-4213 (Integrations, epic 1550; part of sc-4203): Claude compared Ken's accounts with the bank and got three matching to the cent, but the MCP cannot lock the matched rows or record the balance, so the next run cannot tell which rows are proven. The app's Reconcile does both, entirely in the client; the server has no reconcile handler.

Part B (unlock, undo of reconcile, a `through_date` filter) is its own story, filed by the Product Owner. This change is part A only.

## What Changes

- **`write_reconcile_account`** (new scope `transactions:reconcile`): takes an account and a statement balance in cents, computes the cleared balance and the difference as the app does, and when the difference is zero locks the cleared, unreconciled rows and stamps the account's `last_reconciled`. A non-zero difference writes nothing and reports the difference. It never creates the "Reconciliation balance adjustment" row.
- **Always two steps:** the first call returns a dry run (rows to lock, transfer partners it freezes, balance, difference, and fixed text that MCP cannot unlock them) whatever `confirm_destructive` says; the `confirm` is bound by digest to every row's id, amount, date, account and state. The lock is one batch, then the balance is re-read and reported if it no longer matches.
- **Reads:** transaction reads return `reconciled`; a new read tool returns an account's cleared balance, its count of cleared unreconciled rows and `last_reconciled`.
- **`max_reconcile_rows`:** a configurable limit of its own (default 500, operator ceiling 1,000, grant override), because locking flips a flag and `max_rows` (10 in production) is sized for content edits. It is part of the audit-tail startup check.
- **Audit:** the row ids, a `last_reconciled` change, the balances and a plan digest, schema 2, even when no row locks.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

Not in this change (part B, own story): `write_unlock_transactions`, undo of a reconcile, `through_date`. Not planned: auto-creating the adjustment row (Claude uses `write_create_transactions` on the user's say-so, so it is visible and audited).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Reconcile an account", "Reconciliation reads", "Reconciling has its own row limit" and "A reconcile is audited". Additions only: the active change `mcp-budget-maintenance` modifies "Write limits" and the grant requirements, and this change leaves those texts alone: it adds requirements only and no requirement header appears in both deltas, so the two archive in either order (design D8), and the grant key text is folded in when both are archived.

## Impact

- **Code:** new `packages/mcp/src/tools/write/reconcile.ts`; `shared.ts` (`requireReconcileRows`), `limits.ts`, `grants.ts`, `config.ts` (the limit, its ceiling, the grant key, the tail check); `update-plan.ts` or a small plan helper for the lock with split children; the read tools (`reconciled`, cleared balance); typed `updateAccount` field `last_reconciled`; tests, `coverage.json`, `README.md`.
- **api-fork-handlers:** none (design D9). The first test showed `api/account-update` keeps `last_reconciled`, so only the typed `APIAccountEntity` field was added.
- **Hosting (own story after the image ships):** `GRANT_SCOPES` accepts `transactions:reconcile`, and the setting names and grant key pass through, in the order image, allowlist and env, then grants.
- **Reviews:** Tester; Solution Architect; Security Analyst (a bulk flag write behind a confirm); Product Owner reviews intent.
