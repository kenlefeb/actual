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

### D2. One narrow fork handler

`undelete-rows` (`api/undelete-rows`, method `undeleteRows`) takes `{ rows: [{ table, id, columns? }] }`. In code, not from the caller:

- tables it may un-tombstone: `categories`, `category_groups`, `transactions`, `transaction_attachments`;
- columns it may set: `category_mapping.transferId`, `transactions.transfer_id`, `transactions.payee`.

Anything else rejects the whole call before a message is sent. It sends all messages in one `batchMessages`, runs no rules, no transfer hooks and no budget recalculation besides what the sheet does on its own. It does not check state; the MCP planner checks and the lock (Undo A D3.5) keeps the check and the apply together. The budget cells go back through the existing `setBudgetAmount` path, after the rows, as undo of budget cells does.

### D3. What the attempt line holds

Ids and values only, computed before the write under the lock:

- transaction delete: per requested id, the ids it tombstones (row, children, partner, attachments), the row's `transfer_id` before, a partner child's `transfer_id` and `payee` before, and whether any row was reconciled;
- category delete: category, group and transfer ids, each `category_mapping` row it changes (id, `transferId` before and after), and each transfer cell `transfer:month` the move changes (before, after), non-zero months only;
- group delete: the same per category, plus the group id.

The outcome's `applied` names what was deleted, as today.

### D4. Every allowed delete is undoable

Before any audit line, a delete computes its record. It is refused, with fixed text, when the attempt line would exceed the audit line limit or its transfer cells exceed the cell limit. Both are existing settings with grant overrides (Ken's rule: every limit is a configurable default), so no limit is added. A refused delete changes nothing, so production never holds a delete it cannot undo.

### D5. Conflicts

The undo is checked in full first, then applied, and refused naming ids and fields when:

- a logged row is no longer tombstoned, or a logged attachment's transaction differs;
- a live category of the same name is in its group, or a live group of the same name exists (the app forbids both);
- a single category's group is tombstoned (undo the group delete first);
- a mapping row's `transferId` is not what the delete left, or the transfer category is tombstoned;
- a transfer cell does not hold its `after`;
- a partner child's `transfer_id` or `payee` is not null any more;
- a restored row would be reconciled and `allow_reconciled` (with the grant's option) is not given.

### D6. Scopes, limits and confirm

The scope table gains the three deletes with the delete's own scopes: `transactions:write delete`, `structure:write delete`. Restored rows count against the row limit and transfer cells against the cell limit. An undelete adds data back, so it needs no `confirm`.

### D7. The transaction delete tool

`write_delete_transactions { ids, allow_reconciled?, confirm? }`. Ids are explicit; a split child is refused (the parent deletes the split, editing children is `write_update_transactions`); a reconciled row, or a transfer whose partner is reconciled, is refused unless the row's override and the grant's option allow it, as in "Reconciled rows need an explicit override". Rows count against the delete limit, partners and children included. Under `confirm_destructive` the first call is a dry run listing every row it would delete. Each id is deleted through `deleteTransaction`, so the app's split and transfer handling applies.

## Risks

- A sync from another device can un-tombstone or change a row between the check and the apply. The lock covers this process only; the window is the same as Undo A's and the conflict check runs right before the apply.
- `undelete-rows` restores data the caller names. Only the MCP planner calls it, from an owned, schema-2 line in a 0600 append-only log, with tables and columns fixed in code; the Security Analyst reviews it.
- A very large group delete may now be refused (D4). The refusal names the setting.
