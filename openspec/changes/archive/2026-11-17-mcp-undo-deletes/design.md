# Design

## Context

Undo A (`openspec/changes/archive/2026-11-16-mcp-write-undo`) replays audit lines with schema 2, an owner check, a scope table in code, a per-field conflict check, once-only use and the write lock. It refuses deletes. This change adds the transaction delete tool and undo of the three deletes.

What loot-core does on delete (read on `development`, 2026-11-17):

- `db.delete_` sends one CRDT message, `tombstone = 1`. Rows are never removed.
- `deleteCategory` runs `doTransfer` (expense categories only), which adds the deleted category's budgeted amount to the transfer category month by month; the deleted category's own cells stay. `db.deleteCategory` re-points every `category_mapping` row that forwarded to the deleted id, sets the deleted id's own mapping to the transfer, and tombstones the category. Transactions keep the old category id; the views follow the mapping.
- `deleteCategoryGroup` does that for each category, then tombstones the group.
- `api/transaction-delete` tombstones a row, its children when it is a parent, and its attachments. `transfer.onDelete` tombstones the partner, or, when the partner is a split child, sets the child's `transfer_id` and `payee` to null; it also sets the deleted row's `transfer_id` to null.
- The app's own undo (`server/undo.ts`) restores deleted rows by sending `tombstone = 0` on the same ids.

## Decisions

### D1. Restore the original rows, not new ones

Undo of a delete sends `tombstone = 0` for the logged ids and puts back the few columns the delete changed. The rows return with their ids, so notes, goals and templates, hidden, sort order, `is_income`, split structure, attachments and every reference return with them, and nothing is remapped. Re-creating through `createCategory` (takes no id) or `addTransactions` (always a new id, runs rules) was rejected.


### D2. One narrow fork handler, checked inside

`undelete-rows` (`api/undelete-rows`, method `undeleteRows`) takes `{ budget_id, rows: [{ table, id, set? }], cells: [{ category, month, amount }], check? }`. Its rules live in code, never in the call (Security review, PR #406, findings 1 to 3 and 7):

- **Rows**: `table` is one of `categories`, `category_groups`, `transactions`, `transaction_attachments`. Every named row SHALL exist with `tombstone = 1`, read by the handler with a raw query; any row that is missing or live rejects the whole call. This also stops ghost rows from an id the loaded budget lacks.
- **Columns** (`set`, API names, converted to db columns by the schema as `db.updateTransaction` does: `transfer_id` is `transferred_id`, `payee` is `description`) apply only to a row un-deleted in the same call, with one exception, the unlinked partner below.
  - `transactions.transfer_id`: a transaction un-deleted in this call, or the live split child that the delete unlinked, and only when the two name each other.
  - `transactions.payee`: on that partner child only, and only the transfer payee of the restored row's account.
  - `category_mapping.transferId`: an existing mapping row, set only to a category un-deleted in this call. A mapping can then only point at a live category that maps to itself, so no cycle can form.
- **Cells** are set through the budget actions, as `doTransfer` does, inside the same `batchMessages` as the rows. The rows and the cells are applied together or not at all.
- **No rewiring** (Security review, PR #411): a mapping row named must belong to a deleted category, and every restored category must end up mapping to itself. A live split child is relinked only when it is unlinked (`transfer_id` and `payee` null) and not reconciled. Whenever `transfer_id` is set, each side's payee must be the other side's account's transfer payee.
- **`budget_id`** must equal the loaded budget's id, or the call rejects.
- **`check: true`** sends nothing and returns each named row's state (exists, tombstoned, and the columns the planner compares). This is how the planner sees deleted rows, which AQL hides.

It runs no rules and no transfer hooks.

### D3. What the attempt line holds

Ids and values only, computed before the write under the lock, plus `budget_id` (the sync id) on every schema 2 line from now on:

- transaction delete: per requested id, the ids it deletes (row, children, partners, partners of children, attachments), each row's account, payee and date, the row's `transfer_id` before, an unlinked partner child's id, `transfer_id` and `payee` before, and whether any row was reconciled;
- category delete: category, group and transfer ids, each `category_mapping` row it changes (id, `transferId` before and after), and each transfer cell `transfer:month` (before, after), non-zero months only;
- group delete: the same per category, plus the group id.

### D4. Every allowed delete is undoable

Before any audit line, a delete builds both its own attempt line and the attempt line its undo would write. It is refused with fixed text when either would exceed the audit line limit, or its transfer cells exceed the cell limit. The undo counts the rows it restores the way the delete counted them (its transactions, or its categories) against the delete limit (D6), so a delete the delete limit allowed is never refused by the undo for its group row, mappings or attachments. A group delete with a transfer is also refused when the group holds categories deleted earlier: the app re-points their mappings too, and the handler's mapping rule cannot restore them. Both are existing settings with grant overrides (Ken's rule: every limit is a configurable default), so no limit is added.

### D5. Undo: sync, check, apply, verify

1. Run the existing sync, so the check sees what other devices sent.
2. Refuse the whole undo, naming ids and fields, on any conflict:
   - the line's `budget_id` is not the loaded budget's;
   - a logged row is missing or not deleted (from `check`);
   - a logged value is not a string id of the right kind;
   - a live category of the same name is in its group, or a live group of the same name exists;
   - a single category's group is deleted;
   - a mapping row's `transferId` is not what the delete left, or the transfer category is deleted;
   - a transfer cell does not hold its `after`;
   - a restored transaction's account is closed or deleted, or its payee does not resolve to a live payee;
   - an unlinked partner child is deleted, reconciled, or its `transfer_id` or `payee` is no longer null;
   - a restored row is reconciled, or its account was reconciled after the delete (`last_reconciled` later than the delete's time), without `allow_reconciled` and the grant's option.
3. Apply in one `undeleteRows` call.
4. Read the rows and cells back. If another device's change has already overridden any of them, the result and the outcome line say which. The result reflects this server's copy only.

If the handler rejects or throws, nothing was applied, the undo is not used, and it can be retried, as in "An undo is used once it applied".

### D6. Scopes, limits and confirm

The scope table gains the three deletes with the delete's own scopes: `transactions:write delete`, `structure:write delete`. Restored rows count against the delete limit, as the delete counted them (transactions, or categories; never the group row, mappings or attachments), and transfer cells against the cell limit. An undelete adds data back, so it needs no `confirm`.

### D7. The transaction delete tool

`write_delete_transactions { ids, allow_reconciled?, confirm? }`.

- Ids are explicit. A split child is refused: the parent deletes the split, and editing children is `write_update_transactions`.
- A reconciled row is refused unless the row's override and the grant's option allow it, as in "Reconciled rows need an explicit override". So is a row whose reach is reconciled: its transfer partner, its children's partners, or a partner child it would unlink.
- Every row it deletes counts against the delete limit, partners and children included.
- Under `confirm_destructive` the first call is a dry run listing every row it would delete.
- Each id is deleted through `deleteTransaction`, so the app's split and transfer handling applies.

## Risks

- Sync is last-write-wins. A device that was offline can still override a restore after it. D5 step 4 reports what this server sees; it cannot promise more.
- `undelete-rows` writes data from a log line. That line must come from an owned schema 2 entry in a 0600, append-only log. The handler accepts only fixed tables and columns and deleted rows of the loaded budget, and the Security Analyst reviews it.
- A very large group delete may now be refused (D4). The refusal names the setting.
