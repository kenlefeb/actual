# Tasks

## 1. Data and shared computation

- [x] 1.1 Add the migration (account `business_calendar_id` and `deposit_days_early`, `paychecks` table), the AQL schema entries, `AccountEntity` fields and a `PaycheckEntity` type, and document the account fields in `packages/docs/docs/api/types.jsx`; verify `yarn typecheck` passes
- [x] 1.2 Add `shared/paychecks.ts` `computePaycheck`; test the spec's 2,250.00 / 225.00 / 2,025.00 example, the 1,000.01 rounding example and each validation error; verify the tests pass

## 2. Server

- [x] 2.1 Add `account-set-business-days` with validation (0–10 whole days) and test that it stores and undoes; verify it passes
- [x] 2.2 Add `writePaycheckSchedules` and the `paycheck-create`, `paycheck-update`, `paycheck-delete` handlers as undoable mutations, creating the clearing account when asked; test the spec's November 2026 pay and deposit dates, the posted split transaction (amounts, categories, transfer to "Retirement"), editing gross pay leaving posted transactions unchanged, removing a deposit, a deposit with "Post automatically" on posting its transfer on the deposit date (and off posting nothing), deleting a paycheck keeping the clearing account, and undo; verify they pass
- [x] 2.3 Rewrite affected paychecks' schedules from `account-set-business-days`; test the 2-to-1 business days example and its undo; verify they pass
- [x] 2.4 Test that an imported 2,031.40 Checking deposit on November 10, 2026 links to the deposit schedule and becomes a transfer from the clearing account, that 2,600.00 does not, and that an exact 225.00 import merges with an automatically posted Savings deposit; verify they pass
- [x] 2.5 Add `paycheck-skip-next` and test the November 1 skip example; verify it passes

## 3. Client

- [x] 3.1 Add the account "Business days" modal and menu item behind the flag, with the deleted-calendar note and days validation; add component tests; verify they pass
- [x] 3.2 Add `PaycheckEditModal` (clearing account, pay dates, gross pay, deductions, deposits with "Post automatically" and its exact-amount note, live totals and errors) and "Add paycheck" on the schedules page behind the flag; add component tests for live totals, a validation error and the flag-off view; verify they pass
- [x] 3.3 In the schedule editor, show "Part of paycheck … Edit paycheck" for paycheck schedules and offer "Skip next paycheck" and "Delete paycheck" in the paycheck editor; add tests; verify they pass
- [x] 3.4 Run `yarn generate:i18n` and verify the new strings are extracted

## 4. Integration checks

- [x] 4.1 Run `yarn typecheck`, `yarn lint` and `yarn test` from the repository root and verify they pass, except the known local-only `.memsearch/` and `.vexp/` format findings
- [x] 4.2 In the running app with the flag on, set a checking account to 2 business days early in U.S. Federal Reserve, create an "Acme" paycheck (new clearing account, 10% savings, remainder to checking, one deduction), and verify the schedules list and upcoming dates (checked on the demo budget: checking 10/28, 11/10, 11/25; pay and savings 10/30); post the pay schedule and verify the split transaction; skip the next paycheck (pay and savings 11/13, checking 11/10) and undo

## Workflow follow-up

- Release as the next fork version with its release note and feed entry (`yarn generate:fork-news`), per `AGENTS.md`.
- Archive this change after review.
