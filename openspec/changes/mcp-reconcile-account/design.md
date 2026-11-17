# Design

Facts read on origin/development: the app reconciles in the client (`desktop-client/src/accounts/reconciliation.ts`, `Account.tsx`, mobile `AccountTransactions.tsx`); loot-core has no reconcile handler. `loggedWrite` already gives a destructive tool a dry run and a MAC-bound `confirm` under `confirm_destructive`; `update-plan.ts` already knows `reconciled` as a read-back column and cascades split children.

## D1. What the tool does

Cleared balance is `$sum(amount)` over the account's rows with `cleared: true`, splits ignored (the app's `getClearedBalance`). Difference = statement balance minus cleared balance. Difference zero: set `reconciled: true` on every row with `cleared` and not `reconciled` in the account (the app's `lockTransactions`), children following their parent, and stamp `last_reconciled`. Difference not zero: write nothing, return the cleared balance and difference. Stricter than the app on one point: the app stamps `last_reconciled` even when the user exits with a difference; the tool stamps only on a lock. Off-budget accounts reconcile the same way. A closed account is refused. Zero rows to lock with a zero difference still stamps and reports 0 rows locked.

Rejected: creating the adjustment row (the app asks the user; here Claude uses `write_create_transactions`, which is visible, audited and undoable); a `through_date` (part B).

## D2. Dry run and confirm

The tool passes `destructive: true` to `loggedWrite`. The entry's `changes` hold the account's cleared balance and difference as changes on the account id, a `reconciled` false to true change per row, and the `last_reconciled` change; the confirm MAC binds all of them, so a row cleared or edited between the dry run and the confirm is a stale confirm. A dry run whose changes exceed `MAX_RESPONSE_BYTES` is refused with no confirm, as for the budget dry runs. Inside the write the plan is recomputed (balance, difference, row set) and must equal the confirmed one before the first row is written. A difference that is not zero never reaches `loggedWrite`: it is answered as a read, with no audit line and no confirm.

## D3. Scope, limit and who may call

`transactions:write` only. `allow_reconciled` is not needed: it guards changing rows that are already reconciled, and a lock changes none. `max_reconcile_rows` counts the rows to lock including split children, and is checked before any audit line with fixed text naming the count and the limit. It is a setting (default 500, `MAX_RECONCILE_ROWS`), with an operator ceiling (default 2,000, `MAX_RECONCILE_ROWS_CEILING`), and a grant's `max_reconcile_rows` replaces it up to the ceiling; the order is grant, setting, default, as for the other limits. Raising it never raises `max_rows`, `max_cells` or the delete limit, and `max_rows` never limits a reconcile. The audit-tail startup check gains the term 4 x ceiling x 150 bytes (a row id plus one boolean change; 1.2 MB of the 2 MB default tail); the server refuses to start when it does not fit. The grants file schema accepts the key as a positive integer; above the ceiling the file is invalid.

## D4. `last_reconciled`

Read: `AccountEntity.last_reconciled` is a ms timestamp string. `api/account-update` spreads the fields through `accountModel.fromExternal`, `db.updateAccount` validates only name, offbudget and closed, and the column is in the schema, so it should persist; the typed `APIAccountEntity` does not list it. Task 1.1 proves it with a failing test before anything else. If it persists, add `last_reconciled?: string | null` to the typed field list and no handler. If it is dropped, add one fork handler `api/account-last-reconciled-set` with a typed method and a `coverage.json` line, and a delta to `api-fork-handlers`. The value is the server clock in ms as a string; the audit line holds before and after.

## D5. Reads

Transaction reads add `reconciled`. `get_account_reconciliation` (`budget:read`) takes an account id and returns the cleared balance, the cleared unreconciled row count, `last_reconciled` and, optionally, a statement balance and the difference, using the same query as the write so the two cannot disagree.

## D6. Audit and undo

One `reconciled` change per row (false to true) and one `last_reconciled` change on the account id, `schema: 2`. Not undoable here: undo is an unlock, which needs `allow_reconciled` and its own tool, so it is part B (`UNDOABLE` is unchanged; the undo of a reconcile line is refused as not undoable until then). The attempt line holds the balance and difference as well.

## Risks

- A statement balance entered in the wrong units (dollars for cents) gives a large non-zero difference and writes nothing, which is the safe failure.
- A sync that adds a cleared row between the read and the lock is caught by the recompute-and-match.
- Two limits touch the audit tail now (cells, reconcile rows); the startup check names which one failed.

## Decisions for Ken

None. The production value of `max_reconcile_rows` belongs with the production grant at deploy.
