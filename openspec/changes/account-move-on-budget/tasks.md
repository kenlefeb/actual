# Tasks

## 1. Contract and failing tests

- [ ] 1.1 Spec for `account-budget-status`. Verify with `openspec validate account-move-on-budget --strict`.
- [ ] 1.2 Add loot-core tests in `server/accounts/move-on-budget.test.ts`, named after the spec scenarios, that fail on `development`:
  - "The account keeps everything": id, transaction ids, balance, `account_id`/`bank` link and schedules are unchanged, and `offbudget` is 0.
  - "The default start date", "Counts match the account" and "Many transfers": the preview's uncategorized counts, the transfers list (first 20 and the remainder) with kept categories, and the starting balance.
  - "The counts follow the start date".
  - "Balance unchanged, To Budget rises, earlier months unchanged" (required, with a categorized transfer in the history), "The budget gains the balance from the start date", "Earlier months change only by uncategorized amounts" and "A negative balance": the account balance, and budget sheet values for the start month and the month before. These tests fix the split's exact amounts (design.md, Decision 1).
  - "Nothing before the start date".
  - "The adjustment in the register": one split on the start date, total 0, with the Starting Balances line and the noted offset line.
  - "A categorized transfer".
  - "Undo": the move, then `undo()`.
  - Refusals: a closed account, an on-budget account and an unknown id.
- [ ] 1.3 Add a sync test with two devices: one moves the account on budget, the other applies its messages, and the budget cells match. Reuse the two-device helpers from `server/paychecks/concurrent-edits.test.ts` if they're on `development` by then.

## 2. Server

- [ ] 2.1 `account-move-on-budget-preview({ id, startDate })` (design.md, Decision 3).
- [ ] 2.2 `account-move-on-budget({ id, startDate })` as `mutator(undoable(...))`: refuse invalid accounts, set `offbudget = 0`, and insert the zero-net split starting balance (Decision 1) in one batch.
- [ ] 2.3 Types in the accounts handlers. Make tasks 1.2 and 1.3 pass.

## 3. UI

- [ ] 3.1 The `account-move-on-budget` modal (design.md, Decision 5): the start date (default the 1st of the current month), the counts, the transfers list (first 20, then "and N more"), the starting balance, Cancel and Move on budget. Phones get a sheet with 40px controls.
- [ ] 3.2 Desktop: "Move on budget…" in the account header menu for open off-budget accounts.
- [ ] 3.3 Phones: the same row in `AccountMenuModal`.
- [ ] 3.4 Component tests: the option shows only for open off-budget accounts, the modal shows the preview's numbers, Cancel calls nothing, and Confirm calls the handler with the chosen date.

## 4. Checks

- [ ] 4.1 `yarn typecheck`, `yarn lint` and the loot-core and desktop-client tests.
- [ ] 4.2 Check the move by hand in a browser, desktop and 375px, on a demo budget: before and after, the sidebar groups, the account balance, the start month's "To Budget", and undo.
- [ ] 4.3 A release note and fork news entry for the next fork prerelease.
