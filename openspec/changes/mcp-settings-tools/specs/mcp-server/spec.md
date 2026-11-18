## MODIFIED Requirements

### Requirement: Every tool declares a scope
Every tool SHALL declare the scopes it needs, chosen from: `budget:read` (every read tool, `sync_budget`, `get_sync_status`, previews), `transactions:write`, `budget:write`, `structure:write` (accounts, categories, payees, tags, rules), `schedules:write` (schedules, paychecks, business calendars), `settings:write` (budget preferences and limits), `delete` and `accounts:delete`. Its description SHALL name the scopes it needs.

#### Scenario: A tool without a scope fails the build
- **WHEN** a tool is registered without a declared scope
- **THEN** the server's tests fail

#### Scenario: Today's write tools
- **WHEN** a client lists the tools
- **THEN** `write_create_transactions` and `write_update_transactions` need `transactions:write`, `write_set_budget_amount` needs `budget:write`, `write_skip_paycheck` needs `schedules:write`, `write_update_settings` needs `settings:write`, `write_move_on_budget` and the category create, update and move tools need `structure:write`, and `write_delete_category` and `write_delete_category_group` need `structure:write` and `delete`

## ADDED Requirements

### Requirement: Settings tools
`get_settings` (`budget:read`) SHALL return the budget preferences and the registry limits with their defaults and ceilings, as native Settings reads them. `write_update_settings` (`settings:write`) SHALL change them by calling the same engine validation and write as the native settings save, not a copy, refusing the whole call with nothing changed on any invalid key or value. No grant SHALL hold `settings:write` unless it lists it.

#### Scenario: Reading limits
- **WHEN** a client with `budget:read` calls `get_settings`
- **THEN** it receives every registry limit with its value, default and ceiling

#### Scenario: Without the scope
- **GIVEN** a grant with `budget:read` and `transactions:write` only
- **WHEN** the client calls `write_update_settings`
- **THEN** the call is refused by scope, audit-logged, and nothing changes

#### Scenario: Out of range
- **GIVEN** a grant with `settings:write`
- **WHEN** the client sets `accounts-write-max-ids` to 900
- **THEN** the first call is refused, names the ceiling 500, returns no `confirm`, and nothing changes

### Requirement: Settings tools reach only the closed list
`write_update_settings` SHALL accept only the keys the native settings save accepts: the listed budget preferences and the registry limit ids. It SHALL NOT change, and `get_settings` SHALL NOT return, the server address, encryption, sign-in or user, sync, any key, or the native-screen switches.

#### Scenario: Server address
- **WHEN** a client with `settings:write` calls `write_update_settings` with a server address key
- **THEN** the call is refused and nothing changes

#### Scenario: Nothing private returned
- **WHEN** a client calls `get_settings`
- **THEN** the result holds no server address, user, encryption or key field

### Requirement: The MCP server's own limits are never settings
Limits that bound the MCP server SHALL never be settable through `settings:write` nor be in the settings registry: the grant's `max_rows`, `max_cells`, `max_delete_rows`, `allow_reconciled`, `confirm_destructive` and scopes; the server's row, cell, delete, reconcile, audit tail and audit line limits; and every ceiling and default. A test SHALL fail if any can be changed through `settings:write`.

#### Scenario: Raising its own cap
- **GIVEN** a grant with `settings:write`
- **WHEN** the client tries to set `max_rows` or `statement-max-age-hours`
- **THEN** the call is refused and the server's limits are unchanged

#### Scenario: A ceiling
- **WHEN** the client tries to set the ceiling of `accounts-register-page-size`
- **THEN** the call is refused

### Requirement: Settings writes are audited and undoable
`write_update_settings` SHALL log each key's value before and after in its attempt line. It SHALL be in the undo table: `write_undo` SHALL restore the logged before values in one save when each key still holds its logged after value, and otherwise refuse with nothing changed.

#### Scenario: Audit line
- **WHEN** a client changes `accounts-register-page-size` from 50 to 120
- **THEN** the attempt line holds that key with before 50 and after 120

#### Scenario: Undo
- **WHEN** the client then calls `write_undo` for that write
- **THEN** the limit is 50 again

#### Scenario: Undo after another change
- **GIVEN** the limit was changed to 80 in the app after the write
- **WHEN** the client calls `write_undo`
- **THEN** the undo is refused and the limit stays 80

### Requirement: Budget type and limit changes always confirm
`write_update_settings` SHALL validate first, refusing an invalid call without a `confirm`. It SHALL answer a valid call that changes `budgetType` or any limit with a dry run listing each key's current and new value and a `confirm`, whatever `confirm_destructive` says, and change nothing until the confirmed call. Undoing it SHALL need a `confirm` when it restores `budgetType`; undoing only limits SHALL not.

#### Scenario: Confirm off
- **GIVEN** a grant with `settings:write` and `confirm_destructive: false`
- **WHEN** the client sets `budgetType` to tracking
- **THEN** the first call returns a dry run and a `confirm`, and the budget type is unchanged

#### Scenario: Confirmed
- **WHEN** the client repeats the call with the `confirm`
- **THEN** the budget type is tracking and the budget is recalculated

#### Scenario: Undoing a budget type change
- **GIVEN** a confirmed change of `budgetType` to tracking
- **WHEN** the client calls `write_undo` for it
- **THEN** the first call returns a dry run and a `confirm`, and the budget type changes back only on the confirmed call

#### Scenario: Undoing a limit change
- **GIVEN** a confirmed change of `accounts-register-page-size` from 50 to 120
- **WHEN** the client calls `write_undo` for it
- **THEN** the limit is 50 again on that call, with no `confirm` asked
