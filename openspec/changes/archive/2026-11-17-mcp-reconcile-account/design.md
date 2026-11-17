# Design

Facts read on origin/development: the app reconciles in the client (`desktop-client/src/accounts/reconciliation.ts`, `Account.tsx`, mobile `AccountTransactions.tsx`); loot-core has no reconcile handler. `loggedWrite` dry-runs and confirms a destructive tool under `confirm_destructive` and hashes the whole audit `entry` into the `confirm`; `withWriteLock` serializes MCP writes; `api/transactions-update` applies one call's rows in one `transactions-batch-update`; `update-plan.ts` refuses edits to a reconciled row, or to a transfer whose other side is reconciled, without `allow_reconciled`. `mcp-budget-maintenance` is merged in code but not archived; this change adds requirements and does not modify any text it modifies (D8).

## D1. What the tool does

Cleared balance is `$sum(amount)` over the account's rows with `cleared: true` that are not split children (the app's `getClearedBalance`, `splits: 'none'`). Difference = statement balance minus cleared balance. Difference zero: lock the rows (D5) and stamp `last_reconciled`. Difference not zero: write nothing, issue no confirm, return the cleared balance and difference. Stricter than the app on one point: the app stamps `last_reconciled` when the user exits with a difference; the tool stamps only on a lock. A closed account is refused. Zero rows with a zero difference still goes through the two steps and stamps.

Rejected: creating the adjustment row (the app asks the user; here Claude uses `write_create_transactions`, which is visible and audited); a `through_date` (part B).

## D2. Scope (Security 2)

A new scope, `transactions:reconcile`, so locking is a permission a grant gives on purpose (Ken: limits come from permissions). Without it any `transactions:write` identity could lock every cleared row of any account, freezing later amount, date and account edits behind `allow_reconciled`. The scope is added to `SCOPES`; `write_reconcile_account` declares it alone, and `transactions:write` does not imply it. A `*` client holds `budget:read` only already, so it never holds it. The stdio entry with `--writes` grants every scope when `ACTUAL_MCP_WRITES_SCOPES` is unset, so it gains it; a set list needs it added. Hosting (own story): the deploy allowlist `GRANT_SCOPES` must accept the name, in the order image, then allowlist and env, then grants (as budget D7), and production's grant adds it only on Ken's say-so. Requirement "Every tool declares a scope" lists the scopes; this change leaves that text and adds the scope in its own requirement.

## D3. Always two steps; what the dry run says (Security 1, 2)

The first call always returns the dry run, whatever `confirm_destructive` says: a lock cannot be undone through MCP until part B, so skipping the preview is never right. This needs a small option on `loggedWrite` (`alwaysConfirm`), which a test pins. The dry run carries fixed text: the rows are locked once confirmed; `write_undo` cannot reverse it; unlocking is possible only in the app or, once released, with `write_unlock_transactions` and the grant's `allow_reconciled` (part B, sc-4784). It lists the row ids and the transfer partner ids (D6), the balance and the difference.

The statement balance is a typo guard, not authorization: the caller can read the cleared balance and pass it back, so the match proves only that the numbers agree. The scope (D2) is the control. `get_account_reconciliation` must not be described as proof of a statement balance. The audit line records the caller's statement balance.

## D4. The confirm binds each row (Security 3)

The audit entry carries a `plan_digest`: SHA-256 over, for every row to lock and every child and partner involved, the id, amount, date, account, cleared flag, parent id and transfer id, plus the cleared balance and statement balance. The MAC hashes the whole entry, so the confirm binds the digest; a swap of amounts that keeps the totals still changes it. The digest stays in the audit line (64 bytes) so the attempt and confirm can be compared later. The `confirm` is bound to the caller and call as for the other tools and lives 5 minutes.

## D5. Selection, splits, atomicity (Security 4, 5)

Select rows with `cleared`, not `reconciled`, `is_child` false, in the account. Add every child of a selected split parent and lock it whatever its own flags. A child whose parent is not selected (the parent is uncleared, or already reconciled) is never selected alone; one whose parent is reconciled while the child is not is reported as `skipped_children` in the dry run and the result. Sum parents and ordinary rows only, so a split counts once (the app's `splits: 'none'`).

Write: inside `withWriteLock`, recompute the plan and require its digest to equal the confirmed one; send all rows in one `api.updateTransactions` call, which the engine applies as one batch; then re-read the cleared balance. The write lock stops other MCP writes but not the app or a sync, so the re-read is the check. If the balance is no longer the statement balance, the rows stay locked (the batch is applied), the result and the outcome line say `verified: false`, give the new balance and difference and list the locked ids, `last_reconciled` is not stamped, and the text says to unlock in the app if wrong. With zero rows no batch is sent; the stamp still follows the re-read.

## D6. Transfer partners (Security 6)

Locking one leg does not touch the other (as in the app) but freezes it: the existing rule refuses amount, date, account and payee edits of a transfer whose other side is reconciled. The dry run lists the other leg's id for every locked transfer, and the digest covers them. No partner row is written.

## D7. Limit, response size, audit tail (Security 7, 8)

`max_reconcile_rows`: setting `MAX_RECONCILE_ROWS` (default 500), operator ceiling `MAX_RECONCILE_ROWS_CEILING` (default 1,000, lowered from the first draft's 2,000), a grant's value up to the ceiling; the order is grant, setting, default. It counts rows to lock with children, is checked before any audit line, and never raises or is limited by `max_rows`, `max_cells` or the delete limit.

Why 1,000: the audit entry is compact (row ids, one `last_reconciled` change, the balances, the digest; no change per row), and the dry run holds the ids once plus partner ids. About 42 bytes an id, so 1,000 rows and 1,000 partner ids are about 84 KB, inside the configurable response size (`MAX_RESPONSE_BYTES`, 100,000 by default, from #388) with the envelope. The tool still refuses a dry run above the setting with no confirm, never shortening it, and raising the setting raises the ceiling's room. At 2,000 ids the worst case would not fit the default, so the ceiling is lowered rather than the dry run made lossy.

Audit tail: the check adds a term for the new ceiling at 100 bytes a row, which counts the id in `ids` and again in `applied` (about 40 each) with margin. The checks are independent per ceiling and each needs 4 writes of its size to fit the tail; one write is one tool's line, so the tail must hold 4 of the largest, which is the maximum of the terms, not their sum. At the defaults the reconcile term is 0.4 MB of 2 MB, below the row term (1 MB), so it never decides.

## D8. Archiving next to mcp-budget-maintenance (Security 9)

That change modifies "Write limits", the grant requirements and "What undo reverses"; it is merged in code and not archived. This change adds only new requirements and does not modify any of those. The grant key `max_reconcile_rows` is specified in its own requirement rather than in the strict-schema text, and the first archive's text should be folded when both are in. Checked: no requirement header appears in both deltas, and `openspec validate --all --strict` passes with both present.

## D9. `last_reconciled`

`AccountEntity.last_reconciled` is a ms timestamp string. `api/account-update` spreads fields through `accountModel.fromExternal`, `db.updateAccount` validates only name, offbudget and closed, and the column is in the schema, so it should persist; the typed `APIAccountEntity` does not list it. Task 1.1 proved it: the test (`last-reconciled.test.ts`) passed on first run, so it persists and no handler is added; the typed field was widened. The audit `changes` entry records `after: 'now'` because the stamp is set at lock time and the confirm hashes the entry; the outcome line holds the stamped value. If it persists, widen the typed fields and add no handler. If dropped, add one fork handler `api/account-last-reconciled-set` with a typed method, a `coverage.json` line and a delta to `api-fork-handlers` (the Product Owner asks that they go together). The audit line holds before and after, including when no row locks.

## D10. Reads, undo

Transaction reads add `reconciled`. `get_account_reconciliation` (`budget:read`) returns the cleared balance, the count of cleared unreconciled rows (children excluded) and `last_reconciled`, from the query the write uses. `UNDOABLE` is unchanged: a reconcile line is refused as not undoable until part B.

## Risks

- A balance in dollars for cents gives a large difference and writes nothing, which is the safe failure.
- A sync that adds a cleared row mid-write is caught by the re-read (D5); the locked rows stay locked.
- Any identity holding `transactions:reconcile` can lock any account's cleared rows: the scope is the control, and production grants should list it deliberately.

## Decisions for Ken

None beyond granting `transactions:reconcile` and a `max_reconcile_rows` value in the production grant at deploy.
