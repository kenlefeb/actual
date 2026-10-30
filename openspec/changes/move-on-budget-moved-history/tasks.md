# Tasks

## 1. Contract and failing tests

- [ ] 1.1 Spec delta for `account-budget-status`. Verify with `openspec validate move-on-budget-moved-history --strict`.
- [ ] 1.2 loot-core tests in `server/accounts/move-on-budget.test.ts`, failing first: "Recorded with the account", "Undo clears them" and the sync test's columns on the other device.
- [ ] 1.3 desktop-client tests, failing first:
  - the `uncategorized` filters with a moved account: history before the start date and the offset line are excluded, later uncategorized transactions are included, and a never-moved account is unaffected (null-safe);
  - "Moved history" in the desktop category cell and on the phone row;
  - the confirmation: Cancel and Categorize anyway on desktop and on the phone edit page, with no confirmation from the start date on.

## 2. Data

- [ ] 2.1 Fork migration adding `accounts.budget_start_date` and `accounts.budget_start_offset` (nullable), plus the AQL schema and `AccountEntity` types. Update ADR 4's "remove fork data" export path.
- [ ] 2.2 `move-on-budget.ts` writes both columns in the move's batch.

## 3. UI

- [ ] 3.1 The `uncategorized` filters in `queries/index.ts` (design.md, Decision 2).
- [ ] 3.2 "Moved history" in the desktop category cell and the phone transaction row (Decision 3).
- [ ] 3.3 The confirmation modal and its use from the desktop category cell and the phone transaction edit page (Decision 4).

## 4. Checks

- [ ] 4.1 `yarn typecheck`, `yarn lint` and the loot-core and desktop-client tests.
- [ ] 4.2 By hand, desktop and 375px, on a demo budget: the uncategorized count before and after a move, undo, "Moved history", and the confirmation.
