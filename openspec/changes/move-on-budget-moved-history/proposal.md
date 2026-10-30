# Proposal

## Why

Moving an off-budget account on budget (sc-467, `account-move-on-budget`) leaves every transaction before the start date uncategorized, as decided, plus the uncategorized offset line of the "Starting Balance" split. The app's red "N uncategorized transactions" count then includes all of them for good, and prompts the user to categorize them: 21 in the demo after one move. If the user follows that prompt, the money lands in past months on top of the starting balance. That's a double count, and the starting balance stops reconciling (Shortcut sc-1141; the PO's and the UX Designer's #109 reviews).

PO decision (2026-10-29): exclude them. The app remembers each moved account's start date, and an additive fork column is fine (ADR 4). The offset line is protected; at minimum the app warns before it's categorized.

## What Changes

- **The move remembers its start date and its offset line.** Two new nullable columns on `accounts`, written in the move's undoable batch:
  - `budget_start_date`, the start date;
  - `budget_start_offset`, the id of the split's offset line.

  Undo clears them, and both sync to other devices like any account field.
- **Moved history isn't uncategorized.** The uncategorized count, the "Uncategorized" list (desktop and phone) and the "Categorize" prompt leave out:
  - a moved account's transactions dated before its start date;
  - its offset line.

  These show "Moved history" instead. Uncategorized transactions from the start date on still count and are still prompted.
- **Categorizing moved history or the offset line asks first.** Choosing a category for either shows a confirmation that explains the double count. Cancel leaves it uncategorized.

Non-goals:
- Changing what the move itself writes. Its amounts and categories stay as in `account-move-on-budget`.
- Accounts moved before this change: they have no stored start date, so their history still counts, and nothing backfills it. See "Open questions".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-budget-status`, which `account-move-on-budget` adds. This change adds requirements to it: "The move remembers its start date", "Moved history isn't uncategorized" and "Categorizing moved history asks first". It doesn't change the existing requirements.

## Impact

- **Data:** one fork migration adding `accounts.budget_start_date` (date) and `accounts.budget_start_offset` (id), both nullable. ADR 4's "remove fork data" export path also drops them.
- **Code:**
  - `packages/loot-core`: the migration, the AQL schema, and `server/accounts/move-on-budget.ts`, which writes both columns in the move's batch.
  - `packages/desktop-client`:
    - the `uncategorized` filters in `queries/index.ts` (`accountFilter` and `uncategorizedTransactions`), which feed the title-bar count and the desktop and phone lists;
    - the category cell in `TransactionsTable.tsx` and the phone transaction views;
    - a new confirmation modal.
- **Upstream:** `queries/index.ts` and `TransactionsTable.tsx` are upstream files. This rides with the sc-467 upstream candidate later, as one story.
