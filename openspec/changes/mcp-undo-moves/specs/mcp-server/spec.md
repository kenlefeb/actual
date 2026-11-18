## ADDED Requirements

### Requirement: Moves log their old place
The attempt line of `write_move_category` SHALL hold `group_id` and `next_category_id` changes, and that of `write_move_category_group` a `next_group_id` change. Each holds the row's next sibling before the move (null when it was last) and the place asked for (null for last), read under the write lock before the write. These lines SHALL NOT hold `before_category_id` or `before_group_id`.

#### Scenario: A category moved from the middle
- **GIVEN** group "X" holding "A", "B", "C"
- **WHEN** a client moves "B" into group "Y" before "D"
- **THEN** the attempt line holds `group_id` from "X" to "Y" and `next_category_id` from "C" to "D"

#### Scenario: A group moved from the end
- **GIVEN** groups "X", "Y", "Z"
- **WHEN** a client moves "Z" before "X"
- **THEN** the attempt line holds `next_group_id` from null to "X"

### Requirement: Undo of a move
`write_undo` of a category or group move SHALL sync first, check every conflict, then put the row back in its old group before its old next sibling, or last when that was null, in one engine call under the write lock. It needs `structure:write`, no `confirm`, and counts 1 row against the current row limit. It restores the order, not the raw sort order values.

#### Scenario: Undo a category move
- **GIVEN** "B" moved from "X" ("A", "B", "C") into "Y", and nothing changed since
- **WHEN** the client calls `write_undo` for the move
- **THEN** "X" holds "A", "B", "C" in that order again, and the log has an undo line with `undoes`

#### Scenario: Undo a group move
- **GIVEN** group "Z" moved from last to before "X", and nothing changed since
- **WHEN** the client calls `write_undo` for the move
- **THEN** "Z" is last again

#### Scenario: Missing scope
- **GIVEN** a connection granted `budget:read` and `budget:write`
- **WHEN** it calls `write_undo` for its own category move
- **THEN** the call is refused by scope naming `structure:write`, and nothing changed

### Requirement: Undo of a move refuses on any conflict
`write_undo` of a move SHALL refuse the whole undo, changing nothing and naming ids and fields only, when the row is gone, is not in its logged after group, or its next sibling is not its logged after one; the old group is gone; the old next sibling is gone or not in the old group; or a category of the same name is now in the old group. A refusal does not use the undo up.

#### Scenario: The old neighbour is gone
- **GIVEN** "B" moved out of "X" ("A", "B", "C"), and "C" deleted since
- **WHEN** the client calls `write_undo` for the move
- **THEN** the call is refused naming "C", "B" stays where it is, and nothing changed

#### Scenario: Moved again since
- **GIVEN** "B" moved into "Y", then moved again into "Z"
- **WHEN** the client calls `write_undo` for the first move
- **THEN** the call is refused naming "B" and `group_id`, and nothing changed

#### Scenario: A name clash in the old group
- **GIVEN** "B" moved out of "X", and a new category "B" created in "X" since
- **WHEN** the client calls `write_undo` for the move
- **THEN** the call is refused and nothing changed

#### Scenario: A change on another device
- **GIVEN** "B" moved into "Y" by MCP, then moved within "Y" on another device that has synced
- **WHEN** the client calls `write_undo` for the move
- **THEN** the undo syncs first, sees the change, and refuses naming `next_category_id`

### Requirement: Every write declares whether it is undoable
Every write tool SHALL be in exactly one code table: undoable, or not undoable with a fixed reason. `list_writes` SHALL show that reason, and `write_undo` SHALL refuse the caller's own such write with it. Each write tool's description SHALL end with "write_undo reverses it." or "Not undoable:" and its reason. Budget templates, account close and delete, move on budget and reconcile SHALL be not undoable.

#### Scenario: Every tool is declared
- **WHEN** the test lists every registered write tool
- **THEN** each is in exactly one table, and its description matches its table

#### Scenario: A declared reason
- **GIVEN** the caller's own `write_move_on_budget` write
- **WHEN** the client calls `list_writes`, then `write_undo` for it
- **THEN** both give the reason that the app has no move-off-budget action, and nothing changed

#### Scenario: Templates stay not undoable
- **WHEN** a client calls `write_undo` for its own `write_apply_budget_templates` write
- **THEN** the call is refused with the templates reason and nothing changed

### Requirement: Permanent actions always confirm
`write_apply_budget_templates`, and `write_close_account` and `write_delete_account` for a bank-linked account, SHALL answer the first call with a dry run and a `confirm` whatever `confirm_destructive` says, and write only when called again with that `confirm` within its lifetime, as in "Confirm before a destructive write". Closing or deleting an account that is not bank-linked SHALL follow `confirm_destructive` as before.

#### Scenario: Confirm off, a bank-linked account
- **GIVEN** a grant with `confirm_destructive` off and a bank-linked account
- **WHEN** a client calls `write_close_account` without `confirm`
- **THEN** nothing changes, and the result is a dry run with a `confirm` saying the unlink cannot be undone

#### Scenario: Confirm off, an unlinked account
- **GIVEN** a grant with `confirm_destructive` off and an account with no bank link
- **WHEN** a client calls `write_close_account`
- **THEN** the account is closed in one call

#### Scenario: Confirm off, templates
- **GIVEN** a grant with `confirm_destructive` off
- **WHEN** a client calls `write_apply_budget_templates` without `confirm`
- **THEN** nothing changes and the result lists the cells with a `confirm`

## MODIFIED Requirements

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring fields, `write_create_transactions` by deleting its rows, every budget-cell tool by restoring the cells, category and group updates by restoring name, hidden and group, their creates by deleting while unused, transaction, category and group deletes by restoring them, and moves by moving them back. It SHALL replay only allowlisted fields of logged ids, and refuse any other write, an old line or a split edit.

#### Scenario: Undo a move
- **GIVEN** a category moved by `write_move_category` and unchanged since
- **WHEN** a client calls `write_undo` for it
- **THEN** the category is back in its old group and place

#### Scenario: A move is not undoable yet
- **GIVEN** a `write_move_category` line logged before moves recorded their place (`schema: 2`, no `next_category_id` change)
- **WHEN** a client calls `list_writes`, then `write_undo` for it
- **THEN** both say it is not undoable because it was logged before moves recorded their place, and nothing changed

#### Scenario: Undo a create
- **GIVEN** 2 transactions created by `write_create_transactions` and unchanged since
- **WHEN** the client calls `write_undo` for it
- **THEN** both are deleted

#### Scenario: Undo a delete
- **GIVEN** 2 transactions deleted by `write_delete_transactions`
- **WHEN** the client calls `write_undo` for it
- **THEN** both are back with their ids

#### Scenario: A partial failure
- **GIVEN** the engine fails on the second of 3 rows during an undo
- **WHEN** the call returns
- **THEN** the outcome line records `applied` and `failed`, the result says so, and the write cannot be undone again

#### Scenario: Carryover is not undoable yet
- **WHEN** a client calls `write_undo` for a `write_set_budget_carryover` write
- **THEN** the call is refused as not undoable and nothing changed

### Requirement: Undo a write
`write_undo { write_id }` SHALL reverse the caller's own earlier write by replaying its audit line, not the engine's undo stack. It SHALL first check, with one refusal text, that the write exists and is the caller's (`subject` and `user_id` both match; `unknown` never matches alone). For the caller's own write it SHALL then give the fixed reason when the line or tool is not undoable, and only then check the reversed tool's scopes from a code table keyed by tool, never from the line.

#### Scenario: Undo a batch of category changes
- **GIVEN** a `write_update_transactions` call that changed the category of 23 transactions
- **WHEN** the client calls `write_undo` with its `write_id`
- **THEN** all 23 have their earlier category and the log has an undo line with `undoes`

#### Scenario: A grant that cannot write transactions
- **GIVEN** a connection granted `budget:read` and `budget:write`
- **WHEN** it calls `write_undo` for its own `write_update_transactions` write
- **THEN** the call is refused by scope naming `transactions:write` and nothing changed

#### Scenario: Another identity's write
- **GIVEN** a read-only connection, and a write by another subject whose `user_id` is also `unknown`
- **WHEN** it calls `write_undo` with that `write_id`, or an unknown one
- **THEN** both are refused with the same text, with no scope or reason named, and nothing changed

#### Scenario: Not undoable
- **WHEN** a client calls `write_undo` for its own write with `applied` null, `read_back` failed, no outcome line, or that is itself a `write_undo`
- **THEN** the call is refused as not undoable with a fixed reason and nothing changed

### Requirement: List my writes
`list_writes` (`budget:read`) SHALL return the caller's own recent writes, newest first, 20 by default and at most 50, each with `write_id`, time, tool, row count, status, `undone` and `undoable` (with its fixed reason when false, from "Every write declares whether it is undoable" or the line's state). It SHALL read at most the last 2 MB of the audit log and never list another identity's write or a budget value.

#### Scenario: Find a write after context loss
- **GIVEN** the caller made 3 writes and another identity made 1
- **WHEN** the client calls `list_writes`
- **THEN** it lists the caller's 3, newest first, and not the other identity's

#### Scenario: Old lines are not undoable
- **GIVEN** an audit line written before `schema: 2`
- **WHEN** the client calls `list_writes`
- **THEN** that write shows `undoable` false with a reason

#### Scenario: A declared tool
- **GIVEN** the caller's own `write_reconcile_account` write
- **WHEN** the client calls `list_writes`
- **THEN** it shows `undoable` false with the reason that MCP cannot unlock reconciled rows

### Requirement: One write cannot fill the audit tail
A write whose attempt audit line would exceed the audit line limit (a setting, default a quarter of the audit tail) SHALL be refused with fixed text before any audit line, changing nothing. A write of an undoable tool SHALL also be refused so when the line its undo would write would exceed that limit, so every allowed undoable write can be undone.

#### Scenario: A write with huge notes
- **GIVEN** an audit line limit of 2,500 bytes
- **WHEN** a client updates 3 transactions with 1,000-character notes
- **THEN** the call is refused and nothing changed

#### Scenario: An update whose undo would not fit
- **GIVEN** an update whose own line fits the limit but whose undo's line, with `undoes`, would not
- **WHEN** a client makes the update
- **THEN** the call is refused before any audit line, naming the limit, and nothing changed
