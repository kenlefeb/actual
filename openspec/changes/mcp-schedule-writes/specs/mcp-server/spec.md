## ADDED Requirements

### Requirement: Schedule create tool
`write_create_schedule` (`schedules:write`) SHALL create a schedule from `name`, `payee_id`, `account_id`, an amount (`is`, `isapprox` or `isbetween` in cents), `posts_transaction` (default false) and exactly one date form: a one-time `date`, a `recurrence` with end conditions, or `relative_to`. It SHALL store the same rule as the app's form, return the id and next date, and refuse an unknown id, a closed account, a bad amount or date, or a duplicate name, changing nothing.

#### Scenario: A monthly loan payment
- **GIVEN** the payee "Car Loan Co" and the account "Checking" by id, and a grant with `schedules:write`
- **WHEN** a client calls `write_create_schedule` with name "Car loan", `amount_op` `is`, `amount` -35000, and a monthly `recurrence` starting 2026-12-01 that never ends
- **THEN** the schedule exists with next date 2026-12-01, `list_schedules` shows it, and the audit log has an attempt and an outcome line

#### Scenario: An unknown payee
- **WHEN** a client passes a `payee_id` that is no payee
- **THEN** the call is refused with fixed text, nothing changed, and no audit line is written

### Requirement: Schedule recurrence input
`recurrence` SHALL take `frequency` (daily, weekly, monthly, yearly), `interval`, `start`, optional day `patterns`, `end_mode` (never, after_n_occurrences, on_date) with its `end_occurrences` or `end_date`, `skip_weekend`, `weekend_solve_mode` and `business_calendar_id`, and pass them to the engine unchanged. A call SHALL be refused for an interval below 1, an end mode without its value, an end before the start, or an unknown calendar.

#### Scenario: Twelve payments
- **WHEN** a client creates a monthly schedule with `end_mode` `after_n_occurrences` and `end_occurrences` 12
- **THEN** its next dates stop after the twelfth

#### Scenario: A missing end value
- **WHEN** a client passes `end_mode` `on_date` with no `end_date`
- **THEN** the call is refused and nothing changed

### Requirement: Schedule update tool
`write_update_schedule` (`schedules:write`) SHALL change the given fields of a schedule by id through the engine's update, with the same fields as create plus `reset_next_date`, and return the before and after of each. It SHALL refuse an unknown id, a schedule a paycheck manages (naming the paycheck id), a call with no field, and any invalid value, changing nothing.

#### Scenario: Change the amount
- **GIVEN** the "Car loan" schedule
- **WHEN** a client updates `amount` to -36000
- **THEN** only the amount changed, the result shows -35000 and -36000, and the next date is as before

#### Scenario: A paycheck's schedule
- **WHEN** a client updates a schedule a paycheck manages
- **THEN** the call is refused naming the paycheck, and nothing changed

### Requirement: Schedule dry run
`write_create_schedule` and `write_update_schedule` SHALL accept `dry_run: true`, which returns the changes and the next dates the schedule would have, with no `confirm`, and writes nothing, not even an audit line. Without it they write at once, as non-destructive tools do.

#### Scenario: Preview a loan schedule
- **WHEN** a client creates the monthly "Car loan" schedule with `dry_run` true
- **THEN** the result lists the next dates, and `list_schedules` and the audit log are unchanged

### Requirement: Schedule skip and post tools
`write_skip_schedule_date` (`schedules:write`) and `write_post_schedule_transaction` (`schedules:write` and `transactions:write`) SHALL do what the app's "Skip next date" and "Post transaction" (or "Post transaction today" with `today`) do, by schedule id, and refuse a paycheck-managed or completed schedule, or one with no account. Both are not undoable, and say why.

#### Scenario: Skip
- **GIVEN** a monthly schedule with next date 2026-12-01
- **WHEN** a client calls `write_skip_schedule_date`
- **THEN** the next date is 2027-01-01 and the result shows both

#### Scenario: Not undoable
- **WHEN** a client calls `write_undo` for its own skip
- **THEN** the call is refused with the declared reason and nothing changed

### Requirement: Schedule delete tool
`write_delete_schedule` (`schedules:write` and `delete`) SHALL delete a schedule by id. It is not undoable ("recreate from the dry run's definition; a restore is planned in sc-5522"), so the first call SHALL always be a dry run with a `confirm` naming the schedule, its next date, its relative dependents and its definition, and it writes only with that `confirm`. It SHALL refuse a paycheck-managed schedule.

#### Scenario: Delete with confirm
- **GIVEN** a grant with `schedules:write` and `delete`, and `confirm_destructive` off
- **WHEN** a client calls `write_delete_schedule`, then again with the returned `confirm`
- **THEN** the first call changes nothing and the second deletes the schedule

#### Scenario: Without delete
- **GIVEN** a grant with `schedules:write` only
- **WHEN** a client calls `write_delete_schedule`
- **THEN** the call is refused naming `delete`, and nothing changed

### Requirement: Undo of schedule writes
`write_undo` SHALL reverse `write_create_schedule` by deleting the schedule while it has no linked transactions or relative dependents and is unchanged, and `write_update_schedule` by restoring the logged fields while each still holds its logged value. It SHALL refuse on any conflict, and a write is undone once.

#### Scenario: Undo a create
- **GIVEN** a schedule created by `write_create_schedule` and unchanged since
- **WHEN** a client calls `write_undo` for it
- **THEN** the schedule is gone and the log has an undo line with `undoes`

#### Scenario: Undo an update after another edit
- **GIVEN** an updated amount that was edited again in the app
- **WHEN** a client calls `write_undo` for the update
- **THEN** the call is refused for the conflict and nothing changed

### Requirement: The schedule list shows what an edit needs
`list_schedules` SHALL return for each schedule its payee id, account id, amount operator and amount, date definition, `posts_transaction`, and the id of the paycheck that manages it, if any, beside the fields it returns today.

#### Scenario: Find a schedule to edit
- **WHEN** a client calls `list_schedules` with `budget:read`
- **THEN** each row has the fields a `write_update_schedule` call refers to

### Requirement: Paycheck create and delete tools
`write_create_paycheck` (`schedules:write`) SHALL create a paycheck from a name and a definition (the app's form, existing clearing account) through the engine, returning its id and schedule ids; undo deletes it. `write_delete_paycheck` (`schedules:write`, `delete`) SHALL delete one by id; it is not undoable (sc-5522), so its first call SHALL always be a dry run with a `confirm`. Deductions and deposits SHALL be bounded by the connection's row limit.

#### Scenario: Create a paycheck
- **WHEN** a client calls `write_create_paycheck` with a valid definition
- **THEN** the paycheck and its schedules exist, as the app makes them for the same input

#### Scenario: A delete is not undoable
- **GIVEN** a `write_delete_paycheck` write that was confirmed
- **WHEN** a client calls `write_undo` for it
- **THEN** the call is refused with the declared reason and nothing changed

### Requirement: Schedule scopes and the production grant
The schedule and paycheck tools SHALL use the existing `schedules:write` scope; post also needs `transactions:write` and the delete tools `delete`. No new scope SHALL be added. A grant SHALL hold the scope only when it lists it, and each tool's description SHALL name its scopes.

#### Scenario: Read-only grant
- **GIVEN** a grant with `budget:read` only
- **WHEN** a client calls `write_create_schedule`
- **THEN** the call is refused naming `schedules:write`, and nothing changed

### Requirement: Coverage for schedule and paycheck tools
`packages/mcp/coverage.json` SHALL map the handlers these tools call (`schedule/create`, `schedule/update`, `schedule/delete`, `schedule/skip-next-date`, `schedule/post-transaction`, `paycheck-create`, `paycheck-delete` and their API functions) to their tools, replacing the skip for paycheck create and delete, and `yarn check:mcp-coverage` SHALL pass.

#### Scenario: A mapped handler
- **WHEN** `yarn check:mcp-coverage` runs
- **THEN** it passes, and `paycheck-create` maps to `write_create_paycheck` with a test naming it
