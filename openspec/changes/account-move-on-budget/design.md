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

## Goals / Non-Goals

**Goals:**
- Move an off-budget account on budget without changing its id, transactions, balance, bank-sync link or schedules.
- Make the account's money available to budget from a chosen date, as a starting balance would.
- Show exactly what will change before it changes; Cancel changes nothing.
- One undo step, and the same result on other devices after sync.

**Non-Goals:**
- On budget → off budget.
- Categorizing past transactions for the user.
- Changing the categories on existing transfers.

## Decisions

### 1. The starting balance doesn't change the account's balance

Ken's decision 1 adds "one starting balance transaction" on the start date. A plain transaction of amount B, the account's balance as of the start date, would count B twice: once in the existing transactions and again in the new one. That breaks "the account keeps its balance". So the move adds **one split transaction** with a total of zero:

| Line | Amount | Category | Notes |
|---|---|---|---|
| Parent | 0 | — | Payee "Starting Balance" |
| 1 | +B | "Starting Balances" (income), from `getStartingBalancePayee` | "Starting balance" |
| 2 | −B | none (uncategorized) | "Balance before \<start date\>" |

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

**This needs the PO's confirmation** (see "Open questions").

### 2. Start date

- The default is the first day of the current month, in the budget's month boundaries.
- Any date is allowed, including before the account's first transaction (then B is 0) or in the future (then B includes every transaction up to that date).
- The transaction is dated on the start date and marked cleared. It isn't marked reconciled.

### 3. The warning's counts come from one preview handler

`account-move-on-budget-preview({ id, startDate })` returns:
- `uncategorizedBefore` and `uncategorizedFrom`: counts and totals of the account's non-transfer transactions before the start date and from it on. All of them become uncategorized on-budget transactions.
- `transfersOnBudget`: transfers whose other account is on budget, with each one's category from the other side. They keep their categories (Ken's decision 2) and are listed in the warning.
- `transfersOffBudget`: the count of transfers whose other account is off budget. They become uncategorized on-budget transfers. Actual expects the on-budget side of such a transfer to carry a category, so they're counted as uncategorized too.
- `startingBalance`: B.

Split children count once each; parents with children don't count. Deleted (tombstoned) transactions don't count.

### 4. One undoable mutation

`account-move-on-budget({ id, startDate })` runs as `mutator(undoable(...))`, like the other account handlers.
- It refuses when the account is closed, already on budget, or doesn't exist.
- In one batch, it sets `offbudget = 0` and inserts the split transaction (Decision 1).
- **Undo** restores `offbudget = 1` and removes the transaction.
- **Sync:** both writes are ordinary CRDT messages. Other devices get the flag and the transaction, and `handleAccountChange` updates their budget.

### 5. UI

- **Where the option appears:**
  - Desktop: the account header menu gains "Move on budget…" for open off-budget accounts.
  - Phones: the account menu sheet (`AccountMenuModal`) gains the same row.
  - Both open one new modal, `account-move-on-budget`.
- **What the modal shows:**
  - a start date field;
  - the counts from the preview, refreshed when the date changes, with a list of the on-budget transfers and their categories;
  - the starting balance;
  - **Cancel** and **Move on budget**.

  It follows the existing confirmation style: on phones, a sheet with 40px controls. Moving needs this confirmation.
- **Where the account shows after the move:** it appears under "On budget" in the sidebar and in the phone account list. No reload is needed; the accounts query refreshes.

## Risks / Trade-offs

- **Uncategorized total:** users with a long history will see a large uncategorized total before the start date. The warning says so, with the count and total, and from the start date the total is zero.
- **Upstream files:** `Header.tsx`, `AccountMenuModal.tsx` and `accounts/app.ts`. The additions are small and isolated, which keeps the upstream PR simple later.
- **Bank sync after the move:** imported transactions arrive uncategorized, or categorized by rules, like any on-budget account. Nothing in bank sync reads `offbudget` when importing, apart from what rules do.

## Open questions

1. **Zero-net split vs a plain starting balance (Decision 1).** Ken's decision says "adds one starting balance transaction". A plain one would change the account balance, which the acceptance forbids. The proposal uses a zero-net split instead. **Does this match what Ken meant?**
2. **Transfers to off-budget accounts** become uncategorized on-budget transfers (Decision 3). Should the warning list them, like the on-budget transfers, or only count them?
3. **Default start date:** the first day of the current month, or today?
