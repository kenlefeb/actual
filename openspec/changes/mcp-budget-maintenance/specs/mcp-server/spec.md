## ADDED Requirements

### Requirement: Set many budget amounts
`write_set_budget_amounts` (`budget:write`) SHALL set the budgeted amount of each `{month, category_id, amount}` cell in one call, refusing the whole call before any audit line when a cell has a bad month, amount, category id or repeats another cell, and SHALL return each cell's before and after.

#### Scenario: A bad cell changes nothing
- **WHEN** a client sends 3 cells and the second names an unknown category id
- **THEN** the call is refused and no cell changed

#### Scenario: Before and after
- **WHEN** a client sets 2 cells
- **THEN** the result and the audit line give each cell's before and after

### Requirement: Budget cells have their own limit
A call that would change more budget cells (category-month) than the connection's cell limit SHALL be refused before any audit line, saying the count and the limit. The limit is separate from the row limit.

#### Scenario: Over the cell limit
- **GIVEN** a cell limit of 500
- **WHEN** a client calls `write_set_budget_amounts` with 501 cells
- **THEN** the call is refused and no cell changed

#### Scenario: Rows are not cells
- **GIVEN** a row limit of 10
- **WHEN** a client sets 40 budget cells
- **THEN** the call succeeds

### Requirement: Limits are configurable defaults
The row limit (default 50) and cell limit (default 500) SHALL come from server settings; a grant's `max_rows` or `max_cells` SHALL set that connection's value, above or below the default, up to 1,000 rows and 5,000 cells. A setting or grant above a ceiling SHALL be invalid.

#### Scenario: A setting changes the default
- **GIVEN** the cell setting is 200 and the grant has no `max_cells`
- **WHEN** a client changes 201 cells
- **THEN** the call is refused

#### Scenario: A grant overrides the setting
- **GIVEN** the cell setting is 200 and the grant has `max_cells` 300
- **WHEN** a client changes 250 cells
- **THEN** the call succeeds

#### Scenario: Above a ceiling
- **WHEN** the grants file has `max_cells` 6000
- **THEN** the file is invalid and every write tool is refused by scope

### Requirement: Budget carryover and hold
`write_set_budget_carryover`, `write_hold_budget_for_next_month` and `write_reset_budget_hold` (`budget:write`) SHALL change the same state as the app. Hold SHALL be refused in a tracking budget and SHALL say when nothing was held; each SHALL audit its before and after.

#### Scenario: Hold with nothing to budget
- **GIVEN** a month whose to-budget is 0
- **WHEN** a client holds 100.00
- **THEN** nothing changes and the result says nothing was held

#### Scenario: Hold in a tracking budget
- **WHEN** a client calls hold on a tracking budget
- **THEN** the call is refused with fixed text and nothing changed

### Requirement: Copy and average a budget month
`write_copy_budget_month` and `write_set_budget_to_average` (3, 6 or 12 months) (`budget:write`) SHALL give the cells the app's action gives, count only cells that change against the cell limit, and under `confirm_destructive` SHALL first return every cell's before and after with a `confirm`.

#### Scenario: Dry run then confirm
- **GIVEN** `confirm_destructive` on
- **WHEN** a client calls `write_copy_budget_month`, then again with the returned `confirm`
- **THEN** the first call changes nothing and lists each cell, and the second writes them

#### Scenario: A cell changed after the dry run
- **WHEN** a listed cell changes and the client calls with the old `confirm`
- **THEN** the call is refused and nothing changed

### Requirement: Apply budget templates
`write_apply_budget_templates` (`budget:write`) SHALL apply or overwrite the goal templates of a month, for all or listed categories, with the app's result, the same dry run and cell limit, and no AI.

#### Scenario: Overwrite then undo
- **WHEN** a client overwrites a month's templates and then calls `write_undo`
- **THEN** the budgeted cells return to their earlier values

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

### Requirement: A grant can lower the row cap
A grant's `max_rows` and `max_cells` SHALL set the row and cell limits for that connection, replacing the server's defaults.

#### Scenario: Lowered cap
- **GIVEN** a grant with `max_rows` 10
- **WHEN** the client calls `write_update_transactions` with 11 ids
- **THEN** the call fails and no transaction changed

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring fields, `write_create_transactions` by deleting the created rows, every tool that sets budgeted cells (the single and many amounts, copy, average, templates) by restoring them, category and group updates by restoring name, hidden and group, and their creates by deleting while unused. It SHALL replay only allowlisted fields of the ids in `applied` and `created`, and refuse any other write, an old line or a split.

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
