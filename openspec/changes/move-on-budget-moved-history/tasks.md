# Tasks

## 1. Contract and failing tests

- [x] 1.1 Spec delta for `account-budget-status`. Verify with `openspec validate move-on-budget-moved-history --strict`.
- [x] 1.2 loot-core tests in `server/accounts/move-on-budget.test.ts`, failing first: "Recorded with the account", "Undo clears them" and the sync test's columns on the other device.
- [x] 1.3 desktop-client tests, failing first:
  - the `uncategorized` filters with a moved account: history before the start date and the offset line are excluded, and later uncategorized transactions are included;
  - "A never-moved account keeps its count" (required): the null-safe `$or` clauses keep its uncategorized transactions;
  - "Moved history" in the desktop category cell and on the phone row;
  - the confirmation: Cancel and Categorize anyway on desktop and on the phone edit page, with no confirmation from the start date on;
  - "Bulk categorize includes moved history": one confirmation for the batch, where Cancel changes none and confirm changes all.

## 2. Data

- [x] 2.1 A JS fork migration with an id after `1793300000000`. It reads `PRAGMA table_info(accounts)` and adds `budget_start_date` and `budget_start_offset` (nullable) only when each is missing. Add both to the AQL schema, with `budget_start_date` as `f('date')` written through `toDateRepr`, and to the `AccountEntity` types. Update ADR 4's "remove fork data" export path. Test the migration on a database that already has the columns.
- [x] 2.2 `move-on-budget.ts` writes both columns in the move's batch.

## 3. UI

- [x] 3.1 The `uncategorized` filters in `queries/index.ts` (design.md, Decision 2).
- [x] 3.2 "Moved history" in the desktop category cell and the phone transaction row (Decision 3).
- [x] 3.3 The confirmation modal and its use from the desktop category cell, the phone transaction edit page and bulk categorize on the selection (Decision 4).
- [x] 3.4 File a Backlog story for categorizing through the Rules page's apply path (design.md, Risks).

## 4. Checks

- [ ] 4.1 `yarn typecheck`, `yarn lint` and the loot-core and desktop-client tests.
- [ ] 4.2 By hand, desktop and 375px, on a demo budget: the uncategorized count before and after a move, undo, "Moved history", and the confirmation.
