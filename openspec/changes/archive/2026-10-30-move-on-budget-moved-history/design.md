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

**Two nullable columns on `accounts`:** `budget_start_date` and `budget_start_offset` (the offset line's transaction id).
- `budget_start_date` is stored like `transactions.date`: an AQL `f('date')` field, written through `toDateRepr`. So `date >= $account.budget_start_date` compares integers with integers. A string column would compare as text, and the filter would be silently wrong.
- **The migration is a JS migration**, like `1788468782000_add_messages_pending.js`, with an id after `1793300000000`. It reads `PRAGMA table_info(accounts)` and adds each column only when it's missing. SQLite has no `ADD COLUMN IF NOT EXISTS`, and this rides upstream with sc-467 later. If upstream renumbers the migration, as happened with sc-494, budgets that already have the columns would otherwise fail with `duplicate column name` and not open.

The move writes both columns in its existing batch, so:
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
{
  $or: [
    { 'account.budget_start_offset': null },
    { id: { $ne: '$account.budget_start_offset' } },
  ],
}
```

- That one change covers the title-bar count, the desktop "Uncategorized" list and the phone list, because all three read these filters.
- **Both clauses check for null first.** AQL compiles `$ne` with a field reference to `(id != x OR id IS NULL)` (`server/aql/compiler.ts`). For a never-moved account the offset is NULL, so `id != NULL` would drop every row (found by the Architect on #115). Checking for null first keeps those accounts' uncategorized transactions, and "A never-moved account keeps its count" is a required scenario.
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
- The PO asked for at least a warning on the offset line. This design applies the same confirmation to the history before the start date, because categorizing either one double-counts in the same way. See "Resolved questions".
- **Bulk categorize** (the PO on #115): setting a category on several selected transactions at once, when any of them is moved history, shows one confirmation for the whole batch. Cancel changes none of them, and Categorize anyway changes all of them. This covers the usual way to clear an uncategorized list.
- Rules and imports don't prompt. Server-side writes stay as they are (see Risks).

## Risks / Trade-offs

- **Writes outside the editors:** applying a rule from the Rules page ("Apply actions" to matching transactions), rules running on import or bank sync, and the API can still categorize moved history without a prompt. The prompt covers the editors and bulk categorize, where it happens by hand. **Follow-up:** a Backlog story for the Rules page's apply path.
- **Two devices moving the same account while offline:** each passes the `offbudget` check and writes its own split. The account's cells settle to one offset id, so the other device's offset line shows as uncategorized, and there are two Starting Balances. sc-467 already has this gap; this change only makes it visible.
- **Transactions added later before the start date:** for example, from bank sync or another device after the move. They count as moved history: they aren't in B and aren't prompted, so their amount isn't budgeted anywhere. This is the same gap `account-move-on-budget` accepted for unsynced transactions. This change only stops prompting for them.
- **Accounts moved before this change:** none exist, because moving on budget isn't in any release yet, so there's nothing to backfill (see "Resolved questions").

## Resolved questions

Answered by the PO, with the Architect agreeing, on #115:
1. **The confirmation covers history before the start date as well as the offset line.** Both double-count the same way, and one rule for all moved history is easier to understand. Bulk categorize gets one confirmation for the batch.
2. **No backfill.** Moving on budget isn't in any release (it missed alpha.18), so no budget has a move without the new columns. Don't add a backfill later.
