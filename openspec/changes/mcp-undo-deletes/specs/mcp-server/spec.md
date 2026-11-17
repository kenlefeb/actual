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
`write_delete_transactions` SHALL refuse the whole call, changing nothing, when an id is unknown, already deleted or a split child, or when a row or its transfer partner is reconciled and that row does not set `allow_reconciled` with the grant's option, as in "Reconciled rows need an explicit override".

#### Scenario: A split child
- **WHEN** a client passes the id of a split child
- **THEN** the call is refused naming the child and its parent, and nothing changed

#### Scenario: A reconciled row
- **GIVEN** a reconciled transaction
- **WHEN** a client deletes it without `allow_reconciled`
- **THEN** the call is refused naming the row as reconciled, and nothing changed

### Requirement: Deletes log what their undo needs
The attempt line of a transaction, category or group delete SHALL hold, as ids and values only: every row it deletes or unlinks (children, partners and attachments included) with each changed column's before, each `category_mapping` row it re-points with before and after, and each transfer category cell it changes as `category:month` with before and after.

#### Scenario: A category delete with a transfer
- **GIVEN** "Dining" with budgeted amounts in 2 months and a transfer to "Groceries"
- **WHEN** a client deletes "Dining"
- **THEN** the attempt line names "Dining", its mapping change and the 2 "Groceries" cells with before and after

### Requirement: A delete must be undoable
A delete whose attempt line would exceed the audit line limit, or whose transfer cells exceed the cell limit, SHALL be refused with fixed text before any audit line, changing nothing. These are the existing configurable limits; no other limit applies.

#### Scenario: A group too large to undo
- **GIVEN** a cell limit of 100
- **WHEN** a client deletes a group whose transfer would change 120 cells
- **THEN** the call is refused naming the cell limit, and nothing changed

### Requirement: Undo of a delete restores the original rows
`write_undo` of a transaction, category or group delete SHALL restore the rows it deleted with their original ids, put back the columns and mapping rows it changed, then the transfer cells. It needs the delete's scopes, no `confirm`, and counts rows against the row limit and cells against the cell limit.

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

### Requirement: Undo of a delete refuses on any conflict
`write_undo` of a delete SHALL refuse the whole undo, changing nothing, naming ids and fields, when a logged row is no longer deleted, a live category or group has its name in the same place, a category's group is deleted, a mapping row or transfer cell differs from what the delete left, the transfer category is deleted, an unlinked partner changed, or a restored row is reconciled without `allow_reconciled`.

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
