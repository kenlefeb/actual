# Design

## Context

Undo A (`archive/2026-11-16-mcp-write-undo`) replays schema 2 audit lines. It uses an owner check, a scope table in code keyed by tool, a per-field conflict check, once-only use and the write lock. Undo C (`archive/2026-11-17-mcp-undo-deletes`) added sync first, `budget_id` on every line and an up-front check that a delete's undo line fits. This change reuses all of them. Read on `development` at 2645aa42b:

- `write_move_category` logs `group_id` (before, after) and `before_category_id` with `before: null` always; `write_move_category_group` logs `before_group_id` with `before: null` always. The old place is not recorded.
- `db.moveCategory` and `db.moveCategoryGroup` place a row before a target, or last when there is none, and may renumber siblings' `sort_order` (`shoveSortOrders`). Those renumbered siblings are not logged and don't need to be: order is what users see.
- `whyNot` in `undo.ts` gives "this kind of write is not undoable yet" for every tool outside `UNDOABLE`, and that check runs inside the one-text first check of `write_undo`.
- Only deletes call `requireUndoableLine`. Every other write checks its own line only (`loggedWrite`).
- `loggedWrite` has an `alwaysConfirm` option; `write_reconcile_account` uses it.

## Goals / Non-Goals

**Goals:** undo of category and group moves; a fixed reason for every write that is not undoable; every undoable write's undo line fits; always confirm the two permanent actions.

**Non-Goals:** restoring raw `sort_order` numbers; undo of skip, account tools or carryover (sc-5096, sc-5097); any change to loot-core or `@actual-app/api`.

## Decisions

### D1. Log the old next sibling under a new field name

A category move's attempt line holds:
- `{ id, field: 'group_id', before, after }`, as today.
- `{ id, field: 'next_category_id', before: <old next sibling or null>, after: <before_category_id argument or null> }`.

Both are read under the write lock before the write, from the same `load()` the tool already does. A group move holds `next_group_id` the same way. The `before_category_id` and `before_group_id` changes are dropped from new lines.

Alternative rejected: keep `before_category_id` and fill in its `before`. Production lines already hold `before_category_id: null`, which a planner would read as "was last" and use to put the row last. A new name keeps old lines unambiguous.

### D2. No schema bump; mixed logs read per tool

Lines stay `schema: 2`. A schema number versions the whole line, but this is one tool's field. A bump would make every reader handle two versions for no other gain. Lines in one log are read like this:
- no `schema`: not undoable, as today ("written before undo existed");
- a schema 2 move line without a `next_category_id` or `next_group_id` change: not undoable, reason "logged before moves recorded their place";
- a schema 2 move line with it: undoable.

The planner checks that each logged value is a string id or null before using it, and otherwise refuses as not undoable ("a logged value is not an id of its kind", as Undo C does).

### D3. Undo of a move

The undo runs under the write lock, in this order:
1. Run the existing first checks (owner, `budget_id`, once only, scope `structure:write` from the code table).
2. Sync first (`syncFirst`), so the checks see other devices' changes.
3. Load the groups once and refuse the whole undo, naming ids and fields, when:
   - the category or group is gone;
   - it is no longer in its logged after group;
   - its current next sibling is not its logged after `next_*`;
   - the old group is gone;
   - the old next sibling is gone or no longer in the old group (Product Owner decision 1: refuse, never put it last);
   - a category of the same name (case-insensitive, as the move checks) is now in the old group.
4. Count 1 row against the row limit (`requireRows`), as the move counts.
5. Apply one engine call, `api.moveCategory(id, old_group, old_next ?? undefined)` or `api.moveCategoryGroup(id, old_next ?? undefined)`. Its line holds the swapped `group_id` and `next_*` changes and `undoes`.

An undo is not destructive, so it needs no `confirm`. The undo restores order, not raw `sort_order` values; the spec says so.

Alternative rejected: compare only the group and accept any position. That would silently reorder a group someone rearranged since. A strict check refuses, and the user moves it by hand.

### D4. Not-undoable table in code

`undo.ts` gains `NOT_UNDOABLE: Record<tool, reason>` beside `UNDOABLE`. A test lists every registered write tool and fails unless it is in exactly one table, so a new tool must declare itself. Reasons are fixed text:

| Tool | Reason |
|---|---|
| write_apply_budget_templates | it also stores goals and template automations, which undo cannot restore |
| write_set_budget_carryover | it changes every later month and only the first is logged |
| write_hold_budget_for_next_month | clear it with write_reset_budget_hold |
| write_reset_budget_hold | hold again with write_hold_budget_for_next_month |
| write_skip_paycheck | the engine cannot yet put back a skipped date |
| write_create_account | delete the account with write_delete_account |
| write_update_account, write_reopen_account, write_create_account_group, write_update_account_group | not undoable yet |
| write_delete_account_group | its accounts became ungrouped; recreate the group and regroup them |
| write_close_account, write_delete_account | the bank-sync unlink cannot be undone |
| write_move_on_budget | the app has no move-off-budget action |
| write_set_account_business_days | regenerating paychecks can clear skips and recreate schedules |
| write_reconcile_account | MCP cannot unlock reconciled rows |
| write_undo | an undo cannot be undone |

`whyNot` returns the table's reason. `write_undo` keeps one refusal text for "unknown or not yours", so ids cannot be probed. Once the write is the caller's own, a declared tool gets its reason with the code `not-undoable`. Each write tool's description ends with "write_undo reverses it." or "Not undoable: <reason>.", and a test compares each description with the tables.

### D5. The undo-line check for every undoable tool

Before any audit line, `loggedWrite` runs `requireUndoableLine` for every tool in `UNDOABLE`, not only deletes. That call refuses when the tool's own line or its undo's line would exceed `maxAuditLineBytes` (an existing setting, 512 KB by default, overridable). The undo's line is estimated as Undo C does: the same ids and changes with before and after swapped, plus `undoes`. A create's undo also names one id per created row. No new limit is added.

### D6. Always confirm two permanent actions

`write_apply_budget_templates`, and `write_close_account` and `write_delete_account` when the account is bank-linked, pass `alwaysConfirm`. The first call is a dry run with a `confirm` bound to the call and its changes, as reconcile does, whatever `confirm_destructive` says. An unlinked account keeps today's rule. A templates dry run too large to list is refused with no confirm, as it already is under confirm. With confirm off, that is new: split the call with `category_ids`, or raise the cell limit.

## Risks / Trade-offs

- [A strict position check refuses some undos a user would accept] → The refusal names the field and says to undo by hand; a retry after fixing it works, since a refusal does not use up the undo.
- [Moves logged before this ships stay not undoable] → `list_writes` says why; production has few moves.
- [The always-confirm rule adds a step where confirm is off] → It applies only to permanent, not-undoable actions; production already confirms.

## Migration Plan

No data migration. Old lines are read as in D2. Rolling back to the previous build leaves new move lines not undoable there ("not undoable yet"), which is safe.
