# Tasks

## 1. Reconcile an account (sc-4213)

- [ ] 1.1 Prove `last_reconciled` persists through `api.updateAccount` (design D4): a failing test first. If it persists, add the field to the typed account fields; if not, add the fork handler, typed method, `coverage.json` line and an `api-fork-handlers` delta
- [ ] 1.2 Limit (design D3): `MAX_RECONCILE_ROWS` and `MAX_RECONCILE_ROWS_CEILING` settings (stdio and hosted prefixes), the grant's `max_reconcile_rows`, `requireReconcileRows`, and the audit-tail term in the startup check. Failing tests first: default 500, a setting changes it, a grant lowers or raises it within the ceiling, above the ceiling is invalid, start refused when the tail cannot hold it, `max_rows` neither limits nor is raised by it
- [ ] 1.3 Reads (design D5): `reconciled` in the transaction reads and `get_account_reconciliation`. Failing tests first: split parent and children, off-budget account, the difference with and without a statement balance
- [ ] 1.4 `write_reconcile_account` (design D1, D2, D6) in `reconcile.ts`. Failing tests first: zero difference locks, a non-zero difference writes nothing and stamps nothing, uncleared rows untouched, split children follow, closed account refused, over the limit, dry run then confirm, a dry run too large for the response cap is refused with no confirm, stale confirm after a cleared row changes, recompute before the first write, scope refusal, audit changes per row and the `last_reconciled` change, no adjustment row created, behaviour equals the app's `lockTransactions` on one fixture
- [ ] 1.5 `write_undo` refuses a reconcile line as not undoable (test only; `UNDOABLE` unchanged)
- [ ] 1.6 `coverage.json`, `README.md` (the tool, the read, the limit and the grant key), `yarn check:mcp-coverage`
- [ ] 1.7 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass
