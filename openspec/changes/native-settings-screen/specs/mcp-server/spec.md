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
`get_settings` (`budget:read`) SHALL return the same preferences and limits, with defaults and ceilings, that native Settings reads. `write_update_settings` (`settings:write`) SHALL change them under the same closed keys and validation, refusing the whole call with nothing changed on any invalid key or value. No grant SHALL hold `settings:write` unless it lists it.

#### Scenario: Reading limits
- **WHEN** a client with `budget:read` calls `get_settings`
- **THEN** it receives every limit with its value, default and ceiling

#### Scenario: Without the scope
- **GIVEN** a grant with `budget:read` and `transactions:write` only
- **WHEN** the client calls `write_update_settings`
- **THEN** the call is refused by scope, audit-logged, and nothing changes

#### Scenario: Out of range
- **GIVEN** a grant with `settings:write`
- **WHEN** the client sets `accounts-write-max-ids` to 900
- **THEN** the call is refused, names the ceiling 500, and nothing changes

#### Scenario: Reset to default
- **WHEN** a client with `settings:write` sets a limit to null
- **THEN** the limit returns to its default for the next read on every device
