# Design

## Context

- **Budget status** is `accounts.offbudget` (0 or 1). `account-create` sets it, and nothing changes it afterwards. `account-update` only takes `name`, `last_reconciled` and `account_group_id`.
- **How the budget counts transactions:** category cells sum only transactions that have a category, in accounts with `offbudget = 0` (`server/budget/base.ts:109-125` and the per-cell query in `createCategory`). Uncategorized transactions in on-budget accounts don't change any budget cell. They show only as "uncategorized".
- **The budget already follows an `offbudget` change.** `handleAccountChange` (`server/budget/base.ts:199-220`) runs from the `accounts` table change handler. It recomputes, for every created month, the cells of each category used by that account's transactions. This runs locally and when the change arrives by sync, so other devices update with no extra work.
- **Starting balances today:** `account-create` adds one transaction flagged `starting_balance_flag`, with the "Starting Balance" payee and the "Starting Balances" income category (`getStartingBalancePayee`, `server/accounts/payees.ts:18-36`). It adds no category when the account is off budget.
- **Transfers:**
  - Between an on-budget and an off-budget account, the on-budget side carries the category.
  - Between two on-budget accounts, neither side has a category.
  - So for an off-budget account X:
    - a transfer to an on-budget account has a category on the other side;
    - a transfer to another off-budget account has none on either side.
  - `clearCategory` (`server/transactions/transfer.ts:24-45`) enforces this only for on↔on and off↔off transfers. For an on↔off transfer it leaves both sides as they are.
- **Hidden categories** (found by the Architect on #106). An off-budget transaction can carry a category the user never sees: the table shows "Off budget" instead (`TransactionsTable.tsx:1886-1898`), but rules, file imports and the API can set one, and so can an on↔off transfer's off-budget side. Budget cells ignore it only because they sum `offbudget = 0`. After the move, `handleAccountChange` recomputes every category the account's transactions use, so a hidden category would start counting in its past months.

## Goals / Non-Goals

**Goals:**
- Move an off-budget account on budget without changing its id, transactions, balance, bank-sync link or schedules.
- Make the account's money available to budget from a chosen date, as a starting balance would.
- Show exactly what will change before it changes; Cancel changes nothing.
- One undo step, and the same result on other devices after sync.

**Non-Goals:**
- On budget → off budget.
- Categorizing past transactions for the user.
- Changing the categories on another account's side of a transfer.

## Decisions

### 1. The starting balance doesn't change the account's balance

Ken's decision 1 adds "one starting balance transaction" on the start date. A plain transaction of amount B, the account's balance as of the start date, would count B twice: once in the existing transactions and again in the new one. That breaks "the account keeps its balance". So the move adds **one split transaction** with a total of zero:

| Line | Amount | Category | Notes |
|---|---|---|---|
| Parent | 0 | — | Payee "Starting Balance" |
| 1 | +B | "Starting Balances" (income), from `getStartingBalancePayee` | "Starting balance" |
| 2 | −B | none (uncategorized) | "Offsets transactions before \<start date\> (moved on budget)" |

- B is the sum of the account's transactions dated before the start date, including transfers.
- **Effect:**
  - The budget gains B as income in the start month, so it's ready to assign.
  - The account balance doesn't change.
  - Before the start date, the uncategorized total is B. From the start date on, line 2's −B cancels it, so the uncategorized total is back to what the user adds.
- **Edge cases:**
  - When B is 0, the move adds no transaction.
  - When B is negative (an off-budget credit card, a loan), the lines swap signs, so the budget loses |B| as negative income, the same way `account-create` handles a negative starting balance.
- **Alternatives:**
  - *A plain transaction of B.* Rejected: it changes the balance.
  - *Categorize line 2 instead of leaving it uncategorized.* Rejected: no category fits, and decision 1 keeps the past uncategorized.
  - *Two separate transactions instead of a split.* Viable. The split keeps it one row in the register, and undoing removes both lines together.

**Confirmed by the PO** (Resolved question 1). The invariants are what matter, and the tests fix the exact amounts:
- the account balance never changes;
- the start month's "To Budget" rises by the account's balance on the start date;
- earlier months' totals don't change.

The move also clears every category on this account's transactions before the start date (Decision 6). With those cleared, the transactions before the start date are all uncategorized and total B, so the −B offset cancels them exactly, and the earlier months' category totals don't change. Categories on the other account's side of a transfer sit outside this account, were already in the budget, and stay. The tests (task 1.2) confirm this with a categorized transfer and a hidden category in the history, under both budget types.

**Budget types.** In envelope budgeting, B also shows as "To Budget" in the start month. Tracking budgeting has no "To Budget": B shows as "Starting Balances" income in the start month.

### 2. Start date

- The default is the first day of the current month, and the user can change it (Resolved question 3).
- Any date is allowed, including before the account's first transaction (then B is 0) or in the future (then B includes every transaction up to that date).
- The transaction is dated on the start date and marked cleared. It isn't marked reconciled.

### 3. The warning's counts come from one preview handler

`account-move-on-budget-preview({ id, startDate })` returns:
- `before`: the number of the account's transactions before the start date, all of which become uncategorized, and `categoriesCleared`, how many of them have a category the move clears.
- `from`: the number of transactions from the start date on (so, with the default date, from the 1st of the month to today) that have no category, and `categoriesKept`, how many keep theirs.
- The warning shows these as counts, including "N categories before \<start date\> will be cleared" and "N transactions from \<start date\> keep their category", with no list.
- `transfers`: the account's transfers, newest first, each with its date, other account, amount and, for an on-budget other account, the category it keeps (Ken's decision 2). Transfers to off-budget accounts become uncategorized on-budget transfers, because Actual expects the on-budget side of such a transfer to carry a category. The warning shows the count, then the first 20, then "and N more" (Resolved question 2).
- `startingBalance`: B.

Split children count once each; parents with children don't count. Deleted (tombstoned) transactions don't count.

### 4. One undoable mutation

`account-move-on-budget({ id, startDate })` runs as `mutator(undoable(...))`, like the other account handlers.
- It refuses when the account is closed, already on budget, or doesn't exist.
- In one batch, it sets `offbudget = 0`, clears the categories before the start date (Decision 6), and inserts the split transaction (Decision 1).
- **Undo** restores `offbudget = 1`, restores the cleared categories, and removes the transaction.
- **Sync:** both writes are ordinary CRDT messages. Other devices get the flag and the transaction, and `handleAccountChange` updates their budget.

### 5. UI

- **Where the option appears:**
  - Desktop: the account header menu gains "Move on budget…" for open off-budget accounts.
  - Phones: the account menu sheet (`AccountMenuModal`) gains the same row.
  - Both open one new modal, `account-move-on-budget`.
- **What the modal shows:**
  - a start date field, defaulting to the 1st of the current month;
  - the counts from the preview, refreshed when the date changes;
  - the category counts: categories cleared before the start date and kept from it on;
  - the transfers: the count, then date, other account and amount (with the kept category for on-budget ones), the first 20, then "and N more", and a note that a kept category is cleared if that transfer is edited later;
  - the starting balance;
  - **Cancel** and **Move on budget**.

  It follows the existing confirmation style: on phones, a sheet with 40px controls. Moving needs this confirmation.
- **Where the account shows after the move:** it appears under "On budget" in the sidebar and in the phone account list. No reload is needed; the accounts query refreshes.

### 6. Categories before and from the start date (PO, option b)

- **Before the start date:** the move clears any category on this account's transactions, in the same undoable step. Those months look exactly as they did while the account was off budget, and the offset line cancels them exactly.
- **From the start date on:** existing categories stay. That's current activity the user wants budgeted, and a category a rule or import already set is usually right. Transactions without one stay uncategorized.
- **Other accounts:** the category on the other side of a transfer is never touched (Ken's decision 2).
- Undo restores the cleared categories.

## Risks / Trade-offs

- **A later edit of a kept-category transfer clears it.** After the move, a transfer between this account and an on-budget account is on↔on. Any later edit of that transfer runs `clearCategory`, which clears the other side's kept category and changes that past month. That's existing upstream behavior, but the move creates the case. The warning's transfers list says that kept categories are cleared if the transfer is edited later.
- **A transaction not synced yet.** A transaction dated before the start date, added on another device before the move syncs, isn't in B. The account balance still holds, because the offset nets to zero, but that amount stays uncategorized and isn't in "Starting Balances". That's acceptable.

- **Uncategorized total:** users with a long history will see a large uncategorized total before the start date. The warning says so, with the count and total, and from the start date the total is zero.
- **Upstream files:** `Header.tsx`, `AccountMenuModal.tsx` and `accounts/app.ts`. The additions are small and isolated, which keeps the upstream PR simple later.
- **Bank sync after the move:** imported transactions arrive uncategorized, or categorized by rules, like any on-budget account. Nothing in bank sync reads `offbudget` when importing, apart from what rules do.

## Resolved questions

Answered by the PO on 2026-10-29:
1. **The zero-net split is right.** Moving onto the budget must never change the account balance. On the start date the budget gains exactly the money the account held then, as Starting Balances income, and past months don't shift. The offset line's note is plain: "Offsets transactions before \<date\> (moved on budget)".
2. **The warning lists the transfers.** It shows the count, then each transfer's date, other account and amount: the first 20, then "and N more". There's one confirmation, and Cancel changes nothing.
3. **The default start date is the first of the current month**, and it's editable. The uncategorized count includes the transactions from the 1st to today.
