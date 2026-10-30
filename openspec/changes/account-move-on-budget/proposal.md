# Proposal

## Why

Actual can't change an account's budget status after the account is created (Shortcut sc-467). The account update handler (`account-update` in `server/accounts/app.ts`) can't change `offbudget`. Neither account menu offers it, and the docs say so (`packages/docs/docs/budgeting/credit-cards/index.md`). Today's workaround is to make a new on-budget account, move every transaction with **Edit → Account**, then close the old account. That loses the bank-sync link and the schedules.

Ken settled the product questions on 2026-10-29 (recorded on sc-467), and the PO settled the follow-ups the same day (design.md, "Resolved questions"):
1. Past transactions stay uncategorized. The user picks a start date, and the move adds one starting balance on that date.
2. Transfers to on-budget accounts keep their categories, and the warning lists them.
3. Only off-budget → on-budget for now.
4. The app warns first, with counts, and moves the account only after the user confirms.
5. Upstream later: a candidate for epic #26 once it works here.

## What Changes

- **A new account menu option**, "Move on budget…", on desktop and phones. It appears only for an open off-budget account.
- **A confirmation step.** It shows the start date (defaulting to the first day of the current month, and editable) and what will change:
  - the number of transactions before the start date, which become uncategorized, with "N categories before \<start date\> will be cleared";
  - the number from the start date on (including the 1st of the month to today) without a category, with "N transactions from \<start date\> keep their category";
  - the transfers, with their count, then each one's date, other account and amount, the first 20 followed by "and N more". Transfers to on-budget accounts keep their categories. Transfers to off-budget accounts become uncategorized on-budget transfers;
  - the starting balance the budget gains on the start date.

  One confirmation moves the account; Cancel changes nothing.
- **The move.** It marks the account on budget and adds the starting balance on the start date, in one undoable step that syncs to other devices.
  - The account keeps its id, transactions, balance, bank-sync link and schedules.
  - The starting balance brings the account's balance as of the start date into the budget, through the "Starting Balances" income category. Its amount is the sum of the account's transactions before the start date.
  - **Categories:** categories on this account's transactions before the start date, which the user never saw while it was off budget, are cleared in the same step. Categories from the start date on are kept. Undo restores the cleared ones.
  - **The starting balance never changes the account's balance.** It is one split transaction that nets to zero on the account: a "Starting Balance" line in the income category, and an offset line with no category and the note "Offsets transactions before \<date\> (moved on budget)" (design.md, Decision 1).
- **Two server handlers:**
  - `account-move-on-budget-preview` returns the counts for the confirmation.
  - `account-move-on-budget` does the move.

Non-goals:
- On-budget → off-budget (decision 3).
- Categorizing past transactions, and changing the categories on another account's side of a transfer.
- A public API method. The `@actual-app/api` package isn't changed.

## Capabilities

### New Capabilities

- `account-budget-status`: moving an off-budget account on budget. It covers the menu option, the warning and its counts, what the move keeps, the starting balance, budget effects, undo and sync.

### Modified Capabilities

None.

## Impact

- **Code:**
  - `packages/loot-core`: `server/accounts/app.ts` gets the two handlers and their tests, plus a new `server/accounts/move-on-budget.ts` if the logic outgrows the app file.
  - `packages/desktop-client`:
    - the account header menu (`components/accounts/Header.tsx`), and on phones `components/modals/AccountMenuModal.tsx`;
    - a new confirmation modal, used on desktop and phones, registered in `modals/modalsSlice.ts` and `components/Modals.tsx`.
- **Budget:** no change to the budget code. `server/budget/base.ts` `handleAccountChange` already recomputes every month's category cells when an account's `offbudget` changes, locally and when the change arrives by sync. Budget sums count only categorized transactions in on-budget accounts.
- **Upstream code:** `AccountMenuModal.tsx`, `Header.tsx` and `accounts/app.ts` are upstream files. The change is additive (a menu row and two handlers), so it stays upstreamable (decision 5).
- **Docs:** later, when it goes upstream. `budgeting/credit-cards/index.md` and `accounts/index.md` say this can't be done. The fork doesn't change upstream docs.
- **Data:** no schema change and no migration. The move writes `accounts.offbudget` and inserts one parent transaction with two child transactions.
