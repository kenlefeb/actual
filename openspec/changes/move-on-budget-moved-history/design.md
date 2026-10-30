# Design

## Context

- **What the move writes** (`server/accounts/move-on-budget.ts`, from sc-467):
  - `accounts.offbudget = 0`;
  - cleared categories before the start date, and on this account's sides of transfers;
  - one split on the start date: +B in "Starting Balances" and an uncategorized offset of −B, with the note "Offsets transactions before \<date\> (moved on budget)".

  All of it is one undoable batch, and nothing records the start date.
- **What "uncategorized" means today** (`desktop-client/src/queries/index.ts`): `accountFilter('uncategorized')` and `uncategorizedTransactions()` select transactions in on-budget accounts with `category: null` that aren't transfers to on-budget accounts.
  - They feed the title bar's "N uncategorized transactions" (`bindings.uncategorizedCount`), the desktop "Uncategorized" list (`Account.tsx`) and the phone list (`mobile/budget/UncategorizedTransactions.tsx`, `BudgetPage.tsx`).
- **The prompt:** the desktop category cell shows "Categorize" for a transaction without a category (`TransactionsTable.tsx`, around line 1928). Off-budget and transfer rows show read-only italic text ("Off budget", "Transfer") instead.
- **AQL** supports comparing two fields: a string value starting with `$` is a field reference (`server/aql/compiler.ts`, `compileExpr`). So a filter can compare `date` with `$account.budget_start_date`.

## Goals / Non-Goals

**Goals:**
- After a move, the uncategorized count is what it was before the move.
- Transactions from the start date on that have no category are still counted and prompted.
- The offset line can't be categorized by accident.
- Undo restores the count; other devices agree after sync.

**Non-Goals:**
- Any change to the move's amounts or categories.
- Backfilling accounts moved before this change.

## Decisions

### 1. Store the start date and the offset line on the account

**Two nullable columns on `accounts`:** `budget_start_date` (date) and `budget_start_offset` (the offset line's transaction id). The move writes both in its existing batch, so:
- undo restores them to null with everything else;
- other devices get them as ordinary CRDT messages on the account row.

**Alternatives considered:**
- *Derive the start date from the offset split's note.* Rejected. The note is user-editable and translated text, so a renamed or deleted note would silently put the history back in the count.
- *Derive it from the split's payee and date.* Rejected. A user can add another "Starting Balance" transaction, and there's no reliable way to tell which one is the move's.
- *A flag on each moved transaction.* Rejected. It needs a new `transactions` column and one write per transaction. It also wouldn't cover transactions that sync in later from another device with a date before the start.
- *A flag on the offset line only, with the date stored on the account.* Viable, but it needs a `transactions` column for one row per account. Storing the offset line's id on the account keeps the change to one table.

**Moving the account again:** there's no way to move an account back off budget, only undo, and undo clears both columns. So an account carries at most one move's values. If moving back is ever added, it should clear them too.

**A deleted offset line:** if the user deletes the split, `budget_start_offset` points at a deleted row. That's harmless, because the filters only compare ids. The history before the start date stays excluded.

### 2. "Moved history" in the uncategorized filters

The `uncategorized` filters in `queries/index.ts` add, for the transaction's account:

```js
{
  $or: [
    { 'account.budget_start_date': null },
    { date: { $gte: '$account.budget_start_date' } },
  ],
},
{ id: { $ne: '$account.budget_start_offset' } }   // null-safe in the compiled SQL
```

- That one change covers the title-bar count, the desktop "Uncategorized" list and the phone list, because all three read these filters.
- The offset comparison must be null-safe: an account that was never moved has `budget_start_offset = null`, and `id != NULL` is unknown in SQL. The compiled SQL needs `IFNULL` or `IS NOT`; the implementation's tests cover a never-moved account.
- The filters are client-side, but they read synced account fields, so other devices agree.

### 3. "Moved history" instead of "Categorize"

For a transaction in a moved account dated before its start date, and for the offset line:
- **Desktop:** the category cell shows "Moved history" in the same read-only italic style as "Off budget" and "Transfer" (`TransactionsTable.tsx`).
- **Phones:** the transaction row shows "Moved history" instead of "Uncategorized".
- The cell can still be opened (Decision 4); it just doesn't prompt.

### 4. Categorizing moved history or the offset line asks first

- Choosing a category for one of these transactions, on desktop or on the phone's transaction edit page, opens a confirmation:
  - **title:** "Categorize moved history?"
  - **body:** this transaction is already in the account's starting balance on \<start date\>, so categorizing it counts the money twice and the starting balance stops reconciling.
- **Cancel** leaves it uncategorized. **Categorize anyway** sets the category.
- The PO asked for at least a warning on the offset line. This design applies the same confirmation to the history before the start date, because categorizing either one double-counts in the same way. See "Open questions".
- Bulk edits, rules and imports don't prompt. Server-side writes stay as they are (see Risks).

## Risks / Trade-offs

- **Writes outside the editors:** rules, the API and bulk "Set category" can still categorize moved history without a prompt. Guarding every server path is out of scope; the prompt covers the editors, where it happens by hand.
- **Transactions added later before the start date:** for example, from bank sync or another device after the move. They count as moved history: they aren't in B and aren't prompted, so their amount isn't budgeted anywhere. This is the same gap `account-move-on-budget` accepted for unsynced transactions. This change only stops prompting for them.
- **Accounts moved before this change:** they have no stored date, so they keep today's behavior. Nothing backfills them (see "Open questions").

## Open questions

1. **Ask before categorizing history before the start date, not only the offset line?** The PO asked for at least a warning on the offset line. The design applies the same confirmation to history before the start date, because it double-counts the same way. Is that right?
2. **Backfill accounts moved before this change?** Their start date could be inferred from the move's split (payee "Starting Balance", the offset note, the date). Decision 1 explains why that inference isn't reliable. The proposal is no backfill: the feature hasn't been released in a prerelease yet, so few or no budgets have moved accounts.
