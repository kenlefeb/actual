## ADDED Requirements

### Requirement: Set many budget amounts
`write_set_budget_amounts` (`budget:write`) SHALL set the budgeted amount of each `{month, category_id, amount}` cell in one call, refusing the whole call before any audit line when a cell has a bad month, amount or category id, or repeats another cell, and SHALL return each cell's before and after.

#### Scenario: A bad cell changes nothing
- **WHEN** a client sends 3 cells and the second names an unknown category id
- **THEN** the call is refused and no cell changed

#### Scenario: Before and after
- **WHEN** a client sets 2 cells
- **THEN** the result and the audit line give each cell's before and after

### Requirement: Budget cells have their own limit
A call, or an undo, that would change more budget cells (category and month) than the connection's cell limit SHALL be refused before any audit line, naming the count and the limit. The cell limit is separate from the row limit, and audit lines name cells as `category:month`.

#### Scenario: Over the cell limit
- **GIVEN** a cell limit of 500
- **WHEN** a client calls `write_set_budget_amounts` with 501 cells
- **THEN** the call is refused and no cell changed

#### Scenario: Rows are not cells
- **GIVEN** a row limit of 10
- **WHEN** a client sets 40 budget cells
- **THEN** the call succeeds

### Requirement: Limits are configurable defaults
The row limit (50), cell limit (500), delete limit (50), dry-run response size (100 KB) and their ceilings (1,000, 2,000, 1,000, 1 MB) SHALL be server settings only the operator sets; a grant's `max_rows`, `max_cells` and `max_delete_rows` set that connection's value up to the ceiling. The audit tail is a setting (default 2 MB); the server SHALL refuse to start when it cannot hold 4 writes of ceiling size (150 bytes a cell, 250 a row). A value over its ceiling SHALL be invalid.

#### Scenario: A grant overrides the setting
- **GIVEN** the cell setting is 200 and the grant has `max_cells` 300
- **WHEN** a client changes 250 cells
- **THEN** the call succeeds

#### Scenario: Above the ceiling
- **GIVEN** the cell ceiling is its default
- **WHEN** the grants file has `max_cells` 3000
- **THEN** the file is invalid and every write tool is refused by scope

#### Scenario: A ceiling the audit tail cannot hold
- **GIVEN** the cell ceiling is set to 5,000 and the audit tail to 2 MB
- **WHEN** the server starts
- **THEN** it exits with fixed text naming the two settings

### Requirement: One write cannot fill the audit tail
A write whose attempt audit line would exceed the audit line limit (a setting, default a quarter of the audit tail) SHALL be refused with fixed text before any audit line, changing nothing.

#### Scenario: A write with huge notes
- **GIVEN** an audit line limit of 2,500 bytes
- **WHEN** a client updates 3 transactions with 1,000-character notes
- **THEN** the call is refused and nothing changed

### Requirement: An engine error after a cell was written
When the engine throws while setting a cell of `write_set_budget_amounts`, the server SHALL read the cell back: a cell holding the new amount is applied, and one that cannot be read back is recorded as `maybe_written` and the write is not undoable. `not_written` is the cells minus `applied` and `failed`.

#### Scenario: Throw after the write
- **WHEN** the engine writes the second of 3 cells and then throws
- **THEN** the first two are applied, the third is not written, and undo restores the first two

#### Scenario: Throw and no read-back
- **WHEN** the engine throws on a cell and the read-back fails
- **THEN** the result and outcome line say the cell may have been written and the write is not undoable

### Requirement: Delete tools have their own limit
Tools that delete or close (category group delete, account close and delete, and undo of a create) SHALL count rows against the delete limit, the lower of the delete limit (the grant's `max_delete_rows`, else the setting, at most the ceiling) and the row limit in force (the grant's `max_rows`, else the setting), and a refusal SHALL say it is the delete limit, including for an undo of a create. Raising `max_rows` or `max_cells` SHALL NOT raise it.

#### Scenario: A raised row limit does not widen a delete
- **GIVEN** a grant with `max_rows` 1000 and no `max_delete_rows`
- **WHEN** a client deletes a group of 51 categories
- **THEN** the call is refused and nothing changed

### Requirement: Budget carryover and hold
`write_set_budget_carryover`, `write_hold_budget_for_next_month` and `write_reset_budget_hold` (`budget:write`) SHALL change the same state as the app. Hold SHALL be refused in a tracking budget and SHALL say when nothing was held; each SHALL audit its before and after and is not undoable.

#### Scenario: Hold with nothing to budget
- **GIVEN** a month whose to-budget is 0
- **WHEN** a client holds 100.00
- **THEN** nothing changes and the result says nothing was held

#### Scenario: Hold in a tracking budget
- **WHEN** a client calls hold on a tracking budget
- **THEN** the call is refused with fixed text and nothing changed

### Requirement: Copy and average a budget month
`write_copy_budget_month` and `write_set_budget_to_average` (3, 6 or 12 months) (`budget:write`) SHALL give the cells the app's action gives and count only cells that change. Under `confirm_destructive` the first call SHALL list every cell's before and after, with its category and group name, and a `confirm`, and SHALL be refused, issuing no `confirm`, when the list does not fit the response size setting.

#### Scenario: Dry run then confirm
- **GIVEN** `confirm_destructive` on
- **WHEN** a client calls `write_copy_budget_month`, then again with the returned `confirm`
- **THEN** the first call changes nothing and lists each cell, and the second writes them

#### Scenario: A dry run too large to show
- **GIVEN** a copy that would change 3,000 cells
- **WHEN** a client calls it without `confirm`
- **THEN** the call is refused, no `confirm` is issued and nothing changed

### Requirement: A confirm covers everything a call writes
A `confirm` SHALL bind every value its call would write, including goals and automation-store entries, and each cell SHALL be checked against its `before` inside the write lock; on a mismatch the remaining cells are not written and the result and outcome line name the applied and failed cells.

#### Scenario: A goal changed after the dry run
- **WHEN** a template line changes so a goal differs but the budgeted cells are the same, and the client calls with the old `confirm`
- **THEN** the call is refused and nothing changed

#### Scenario: A cell changed between check and write
- **WHEN** a sync changes the second of 3 cells after the plan was checked
- **THEN** the first is written, the second and third are not, and the result names them

### Requirement: Apply budget templates
`write_apply_budget_templates` (`budget:write`) SHALL apply or overwrite the goal templates of a month, for all or listed categories, with the app's result, the same dry run and cell limit, and no AI. Its audit line SHALL record each cell's goal before and after, and it is not undoable until goals and the automation store are restored.

#### Scenario: Overwrite is audited with goals
- **WHEN** a client overwrites a month's templates
- **THEN** the audit line holds each cell's budgeted and goal before and after

#### Scenario: Templates are not undoable
- **WHEN** a client calls `write_undo` for a `write_apply_budget_templates` write
- **THEN** the call is refused as not undoable and nothing changed

### Requirement: Undo of budget cells
`write_undo` of a budget-cell write SHALL be counted against the cell limit, not the row limit, and SHALL match cells by category and month. It SHALL refuse the whole undo, changing nothing, when any applied cell no longer holds the value the write left; cells the write did not apply are ignored. A write that stopped midway records only its applied cells, so its undo restores those.

#### Scenario: A large write is undone
- **GIVEN** a 200-cell `write_set_budget_amounts` under the default limits
- **WHEN** the client calls `write_undo` for it
- **THEN** all 200 cells are restored

#### Scenario: A write that stopped midway
- **GIVEN** a write of two cells for one category, in two months, where the engine failed on the second
- **WHEN** the client calls `write_undo` for it
- **THEN** the first cell is restored and the second is not touched

#### Scenario: One applied cell changed since
- **WHEN** one of the applied cells was edited after the write and the client calls `write_undo`
- **THEN** the undo is refused and no cell changed

## RENAMED Requirements

- FROM: `### Requirement: A grant can lower the row cap`
- TO: `### Requirement: A grant sets the row and cell limits`

## MODIFIED Requirements

### Requirement: Write limits
Writes SHALL take explicit ids and never a name matched from text, SHALL change at most the row limit of rows (default 50) and the cell limit of budget cells (default 500) per call, and SHALL return the before and after values of every field changed.

#### Scenario: Over the row limit
- **WHEN** a client calls `write_update_transactions` with 51 ids
- **THEN** the call fails and no transaction changed

#### Scenario: Before and after
- **GIVEN** a transaction categorized "Groceries"
- **WHEN** a client calls `write_update_transactions` to set it to the `category_id` of "Dining"
- **THEN** the result shows category "Groceries" before and "Dining" after, and the transaction is "Dining"

#### Scenario: A name where an id is required
- **WHEN** a client calls `write_update_transactions` with the category name "Dining" instead of its id
- **THEN** the call fails and nothing changed

### Requirement: A grant sets the row and cell limits
A grant's `max_rows`, `max_cells` and `max_delete_rows` SHALL set the row, cell and delete limits for that connection, up to the server's ceilings, replacing the server defaults.

#### Scenario: Lowered cap
- **GIVEN** a grant with `max_rows` 10
- **WHEN** the client calls `write_update_transactions` with 11 ids
- **THEN** the call fails and no transaction changed

### Requirement: Hosted grants come from a grants file
The hosted entry SHALL read grants from the file named by `ACTUAL_MCP_GRANTS_FILE`. Each grant names an OAuth subject, a client id or `*`, its scopes and optional `confirm_destructive`, `max_rows`, `max_cells`, `max_delete_rows` and `allow_reconciled` (off when absent). The file SHALL be checked on every call, so a change applies on the next call without a restart. An exact client id SHALL take precedence over `*`; a connection with no matching grant SHALL have no scopes.

#### Scenario: A grant change applies on the next call
- **GIVEN** the assistant's grant includes `transactions:write`
- **WHEN** the grants file is replaced with one that removes `transactions:write`, and the client calls `write_update_transactions` with its existing token
- **THEN** the call is refused by scope, without a restart

#### Scenario: A named client gets writes, others read
- **GIVEN** a grant for the subject with client `*` and `budget:read`, and another for the pre-registered client id with `transactions:write`
- **WHEN** a dynamically registered client calls `write_update_transactions`
- **THEN** the call is refused by scope, while the same call from the pre-registered client succeeds

### Requirement: The grants file schema is strict
A grants file SHALL be valid only when `version` is 1, it has no unknown keys, each `scopes` is a non-empty array of known scope names, `max_rows`, `max_cells` and `max_delete_rows` are positive integers not above their server ceilings, `confirm_destructive` and `allow_reconciled` are booleans, `subject` is a literal subject (never a wildcard), no (subject, client) pair appears twice, and every `*` client grant holds `budget:read` only and no `allow_reconciled`.

#### Scenario: A duplicate pair
- **WHEN** the grants file has two grants for the same subject and client
- **THEN** the file is invalid and every connection is treated as granted `budget:read` only

#### Scenario: Writes on the wildcard client
- **WHEN** the grants file gives client `*` the scope `transactions:write`
- **THEN** the file is invalid and every write tool is refused by scope

#### Scenario: An unknown key
- **WHEN** a grant carries a key `admin: true`
- **THEN** the file is invalid and every write tool is refused by scope

#### Scenario: A non-boolean reconciled override
- **WHEN** a grant carries `allow_reconciled: "yes"`
- **THEN** the file is invalid and every write tool is refused by scope

#### Scenario: A reconciled override on the wildcard client
- **WHEN** the client `*` grant carries `allow_reconciled: true`
- **THEN** the file is invalid and every write tool is refused by scope

### Requirement: Category group delete transfer target and limits
The transfer category for `write_delete_category_group` SHALL exist, SHALL NOT be in the group being deleted, and SHALL be an expense category. The income group SHALL be refused, and so SHALL a group of more categories than the delete limit. A group delete SHALL write one attempt and one outcome audit line naming the group, its categories and the transfer id.

#### Scenario: A transfer inside the group
- **WHEN** a client calls `write_delete_category_group` for "Food" with the id of "Snacks"
- **THEN** the call is refused and nothing changed

#### Scenario: Too many categories
- **GIVEN** a group of 51 categories
- **WHEN** a client calls `write_delete_category_group` for it
- **THEN** the call is refused and nothing changed

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring fields, `write_create_transactions` by deleting the created rows, every tool that sets budgeted cells (single and many amounts, copy, average) by restoring them, category and group updates by restoring name, hidden and group, and their creates by deleting while unused. It SHALL replay only allowlisted fields of the ids in `applied` and `created`, and refuse any other write, an old line or a split.

#### Scenario: A move is not undoable yet
- **WHEN** a client calls `write_undo` for a `write_move_category` write
- **THEN** the call is refused as not undoable and nothing changed

#### Scenario: Undo a create
- **GIVEN** 2 transactions created by `write_create_transactions` and unchanged since
- **WHEN** the client calls `write_undo` for it
- **THEN** both are deleted

#### Scenario: A partial failure
- **GIVEN** the engine fails on the second of 3 rows during an undo
- **WHEN** the call returns
- **THEN** the outcome line records `applied` and `failed`, the result says so, and the write cannot be undone again

#### Scenario: Carryover is not undoable yet
- **WHEN** a client calls `write_undo` for a `write_set_budget_carryover` write
- **THEN** the call is refused as not undoable and nothing changed
