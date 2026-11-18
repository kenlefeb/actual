## ADDED Requirements

### Requirement: Delete transactions
`write_delete_transactions` (`transactions:write`, `delete`) SHALL delete transactions by explicit id as the app does: a split parent with its children, a transfer with its partner (a partner that is a split child is unlinked, not deleted), and their attachments. Every deleted row, partners and children included, SHALL count against the delete limit. Under `confirm_destructive` it SHALL dry-run first, listing every row.

#### Scenario: A transfer
- **GIVEN** a transfer from Checking to Savings
- **WHEN** a client deletes the Checking side
- **THEN** both sides are gone, as when the app deletes it

#### Scenario: A split
- **WHEN** a client deletes a split parent with 3 children
- **THEN** the parent and its 3 children are gone, and 4 rows counted against the delete limit

#### Scenario: Dry run then confirm
- **GIVEN** a grant with `transactions:write delete` and `confirm_destructive`
- **WHEN** the client calls without `confirm`, then with the returned `confirm`
- **THEN** the first call changes nothing and lists the rows, and the second deletes them

#### Scenario: Missing scope
- **GIVEN** a grant with `transactions:write` and no `delete`
- **WHEN** the client calls `write_delete_transactions`
- **THEN** the call is refused by scope naming `delete`, and nothing changed

### Requirement: Transaction delete refusals
`write_delete_transactions` SHALL refuse the whole call, changing nothing, when an id is unknown, already deleted or a split child, or when any row it would delete or unlink is reconciled (the row, its transfer partner, a child's transfer partner, or a partner child it would unlink) and that row does not set `allow_reconciled` with the grant's option, as in "Reconciled rows need an explicit override".

#### Scenario: A split child
- **WHEN** a client passes the id of a split child
- **THEN** the call is refused naming the child and its parent, and nothing changed

#### Scenario: A reconciled row
- **GIVEN** a reconciled transaction
- **WHEN** a client deletes it without `allow_reconciled`
- **THEN** the call is refused naming the row as reconciled, and nothing changed

#### Scenario: A child's reconciled partner
- **GIVEN** a split whose child is a transfer to "Savings", with the Savings side reconciled
- **WHEN** a client deletes the split parent without `allow_reconciled`
- **THEN** the call is refused naming the Savings side, and nothing changed

### Requirement: Audit lines name the budget
Every schema 2 audit line SHALL carry `budget_id`, the sync id of the loaded budget. `write_undo` SHALL refuse, with the unknown-id text, a line without `budget_id` or with one other than the loaded budget's.

#### Scenario: Another budget is loaded
- **GIVEN** a delete logged while budget X was loaded, and the server now has budget Y
- **WHEN** the client calls `write_undo` for it
- **THEN** the call is refused as unknown and nothing changed

### Requirement: Deletes log what their undo needs
The attempt line of a transaction, category or group delete SHALL hold, as ids and values only: every row it deletes or unlinks (children, partners, children's partners and attachments included) with its account, payee and date and each changed column's before, each `category_mapping` row it re-points with before and after, and each transfer cell as `category:month` with before and after.

#### Scenario: A category delete with a transfer
- **GIVEN** "Dining" with budgeted amounts in 2 months and a transfer to "Groceries"
- **WHEN** a client deletes "Dining"
- **THEN** the attempt line names "Dining", its mapping change and the 2 "Groceries" cells with before and after

### Requirement: A delete must be undoable
A delete SHALL be refused with fixed text before any audit line, changing nothing, when its attempt line or the attempt line its undo would write would exceed the audit line limit, or its transfer cells exceed the cell limit. These are the existing configurable limits; no other limit applies.

#### Scenario: A group too large to undo
- **GIVEN** a cell limit of 100
- **WHEN** a client deletes a group whose transfer would change 120 cells
- **THEN** the call is refused naming the cell limit, and nothing changed

### Requirement: A group delete keeps its mappings undoable
A category group delete with a transfer SHALL be refused, changing nothing and before any audit line, when the group holds categories deleted earlier (the message says so and names no ids): the app would re-point their mappings and an undo could not restore them. Without a transfer such a group SHALL delete as before.

#### Scenario: An earlier-deleted category in the group
- **GIVEN** a group holding a live category and one deleted earlier
- **WHEN** a client deletes the group with `transfer_category_id`
- **THEN** the call is refused saying the group holds categories deleted earlier and advising a delete without a transfer or in the app (it names no ids), and nothing is logged or changed

#### Scenario: The same group without a transfer
- **WHEN** a client deletes that group with no transfer category
- **THEN** it is deleted, and its undo restores it

### Requirement: Undo of a delete restores the original rows
`write_undo` of a transaction, category or group delete SHALL sync first, check every conflict, then restore the deleted rows with their original ids, the columns and mapping rows it changed, and the transfer cells in one `undeleteRows` call, all or nothing. It needs the delete's scopes, no `confirm`, and counts the rows the delete counted (its transactions, or its categories) against the delete limit and cells against the cell limit.

#### Scenario: A category comes back
- **GIVEN** "Dining" with notes, a goal and 12 transactions, deleted with a transfer to "Groceries"
- **WHEN** the client calls `write_undo` for the delete
- **THEN** "Dining" has its id, notes and goal again, its 12 transactions show "Dining", and the "Groceries" cells hold their earlier amounts

#### Scenario: A transfer comes back
- **GIVEN** a deleted transfer whose partner was a split child
- **WHEN** the client calls `write_undo` for the delete
- **THEN** the row has its id again and the child is linked to it with its earlier payee

#### Scenario: A group comes back
- **WHEN** the client undoes a group delete
- **THEN** the group and all its categories are back with their ids and order

#### Scenario: A large group at the default limits
- **GIVEN** a group of 26 categories deleted with a transfer, at the default limits
- **WHEN** the client undoes the delete
- **THEN** the group and all 26 categories come back, because the undo counts 26 rows against the delete limit, as the delete did

#### Scenario: The limit was lowered since
- **GIVEN** a delete of 3 rows, and a delete limit lowered to 2 afterwards
- **WHEN** the client undoes it
- **THEN** the undo is refused naming the limit, and nothing changed

#### Scenario: The handler fails
- **WHEN** `undeleteRows` throws during an undo of a category delete
- **THEN** the category is still deleted, the "Groceries" cells are unchanged, and the undo can be retried

### Requirement: Undo of a delete reports what it sees
After the restore, `write_undo` SHALL read the restored rows and cells back, and the result and outcome line SHALL name any that another device's change already overrode. The result reflects this server's copy of the budget only.

#### Scenario: Overridden by a sync
- **WHEN** a sync during the undo brings another device's later edit of a restored row
- **THEN** the result names that row as overridden instead of reporting it restored

### Requirement: Undo of a delete refuses on any conflict
`write_undo` of a delete SHALL refuse the whole undo, changing nothing, naming ids and fields, when a logged row is missing or not deleted, a logged value is not an id of its kind, a live category or group has its name in the same place, a category's group or the transfer category is deleted, or a mapping row or transfer cell differs from what the delete left.

#### Scenario: The name is taken
- **GIVEN** a deleted category "Dining" and a new "Dining" in the same group
- **WHEN** the client undoes the delete
- **THEN** the undo is refused naming the category and `name`, and nothing changed

#### Scenario: The transfer cell changed
- **GIVEN** a category delete that moved amounts to "Groceries", and a later edit of one of those cells
- **WHEN** the client undoes the delete
- **THEN** the undo is refused naming the cell, and the category stays deleted

#### Scenario: Its group is gone
- **GIVEN** a deleted category whose group was deleted later
- **WHEN** the client undoes the category delete
- **THEN** the undo is refused naming the group, and nothing changed

### Requirement: Undo of a transaction delete checks live references
`write_undo` of a transaction delete SHALL also refuse when a restored row's account is closed or deleted, its payee does not resolve to a live payee, its category is deleted and forwards to no live category, an unlinked partner child is deleted, reconciled or no longer unlinked, or, without `allow_reconciled` and the grant's option, a restored row is reconciled or its account was reconciled after the delete.

#### Scenario: Its account is gone
- **GIVEN** a deleted transaction whose account was later deleted in the app
- **WHEN** the client undoes the delete
- **THEN** the undo is refused naming the account, and nothing changed

#### Scenario: Reconciled since
- **GIVEN** a deleted transaction whose account was reconciled after the delete
- **WHEN** the client undoes the delete without `allow_reconciled`
- **THEN** the undo is refused naming the account as reconciled since, and nothing changed

#### Scenario: Its category is gone
- **GIVEN** a deleted transaction whose category was deleted later without a transfer
- **WHEN** the client undoes the delete
- **THEN** the undo is refused naming the category, and nothing changed

#### Scenario: Its partner child is gone
- **GIVEN** a deleted transfer whose partner split child was unlinked, and the child's split deleted later
- **WHEN** the client undoes the delete
- **THEN** the undo is refused naming the child, and nothing changed

## MODIFIED Requirements

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring fields, `write_create_transactions` by deleting its rows, every budget-cell tool (single and many amounts, copy, average) by restoring the cells, category and group updates by restoring name, hidden and group, their creates by deleting while unused, and transaction, category and group deletes by restoring them. It SHALL replay only allowlisted fields of logged ids, and refuse any other write, an old line or a split edit.

#### Scenario: A move is not undoable yet
- **WHEN** a client calls `write_undo` for a `write_move_category` write
- **THEN** the call is refused as not undoable and nothing changed

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
