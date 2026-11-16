## ADDED Requirements

### Requirement: Writes return their id
Every write tool SHALL return `write_id` in its result, equal to the `call_id` of its audit lines.

#### Scenario: A write names itself
- **WHEN** a client calls `write_update_transactions` for 2 rows
- **THEN** the result carries a `write_id` that is the `call_id` of the attempt and outcome lines

### Requirement: List my writes
`list_writes` (`budget:read`) SHALL return the caller's own recent writes, newest first, 20 by default and at most 50, each with `write_id`, time, tool, row count, status, `undone` and `undoable` (with a fixed-text reason when false). It SHALL read at most the last 2 MB of the audit log and never list another identity's write or a budget value.

#### Scenario: Find a write after context loss
- **GIVEN** the caller made 3 writes and another identity made 1
- **WHEN** the client calls `list_writes`
- **THEN** it lists the caller's 3, newest first, and not the other identity's

#### Scenario: Old lines are not undoable
- **GIVEN** an audit line written before `schema: 2`
- **WHEN** the client calls `list_writes`
- **THEN** that write shows `undoable` false with a reason

### Requirement: Undo a write
`write_undo { write_id }` SHALL reverse the caller's own earlier write by replaying its audit line, and not the engine's undo stack. It SHALL need exactly the scopes of the write it reverses, check in the handler, and no other permission. It SHALL append its own attempt and outcome lines with `undoes` set to the original `write_id`, and SHALL reverse a write once.

#### Scenario: Undo a batch of category changes
- **GIVEN** a `write_update_transactions` call that changed the category of 23 transactions
- **WHEN** the client calls `write_undo` with its `write_id`
- **THEN** all 23 have their earlier category and the log has an undo line with `undoes`

#### Scenario: A grant that cannot write transactions
- **GIVEN** a connection granted `budget:read` and `budget:write`
- **WHEN** it calls `write_undo` for a `write_update_transactions` write
- **THEN** the call is refused by scope naming `transactions:write` and nothing changed

#### Scenario: Another identity's write
- **WHEN** a client calls `write_undo` with the `write_id` of another identity's write, or an unknown one
- **THEN** both are refused with the same text and nothing changed

#### Scenario: A second undo
- **GIVEN** a write that was already undone
- **WHEN** the client calls `write_undo` for it again
- **THEN** the call is refused naming the undo's `write_id` and nothing changed

### Requirement: Undo refuses on any conflict
`write_undo` SHALL compare each logged field of each row with the value the write left, and SHALL refuse the whole undo, changing nothing, if any differs, any row is missing, or a created category or group is in use. The refusal SHALL name row ids and field names, never budget values or names, and say the user can review and undo by hand. Fields the write did not touch SHALL NOT be compared.

#### Scenario: A later edit
- **GIVEN** a write that changed 3 transactions' category, and a later edit of one's category
- **WHEN** the client calls `write_undo`
- **THEN** the call is refused naming that transaction and `category`, and all 3 are unchanged

#### Scenario: Another field changed
- **GIVEN** a write that changed notes, and a later change of the same row's cleared flag
- **WHEN** the client calls `write_undo`
- **THEN** the notes are restored and cleared is unchanged

#### Scenario: A used category
- **GIVEN** a category created by a write and later assigned to a transaction
- **WHEN** the client calls `write_undo` for the create
- **THEN** the call is refused and the category still exists

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring the fields, `write_create_transactions` by deleting the created rows, `write_set_budget_amount` by restoring the amount, and the category and group update tools by restoring name, hidden and group, and their create tools by deleting while unused. It SHALL refuse any other write, any line without `schema: 2`, and a transfer pair or split, with fixed text; reconciled rows need `allow_reconciled`.

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

### Requirement: Account deletes have their own scope
The scope `accounts:delete` SHALL be a known scope, valid in the grants file and the stdio environment. Account close, account delete and account group delete SHALL need `structure:write` and `accounts:delete`, and not `delete`. `delete` SHALL NOT imply `accounts:delete`, nor the reverse. A `*` client with `accounts:delete` is invalid.

#### Scenario: Delete does not allow an account delete
- **GIVEN** a connection granted `budget:read structure:write delete`
- **WHEN** the client calls `write_close_account`
- **THEN** the call is refused naming `accounts:delete` as missing

#### Scenario: Accounts only
- **GIVEN** a connection granted `budget:read structure:write accounts:delete`
- **WHEN** the client calls `write_delete_category`
- **THEN** the call is refused naming `delete` as missing

## MODIFIED Requirements

### Requirement: Every tool declares a scope
Every tool SHALL declare the scopes it needs, chosen from: `budget:read` (every read tool, `sync_budget`, `get_sync_status`, previews), `transactions:write`, `budget:write`, `structure:write` (accounts, categories, payees, tags, rules), `schedules:write` (schedules, paychecks, business calendars), `delete` and `accounts:delete`. A tool that deletes, closes or merges SHALL need its area's write scope and `delete`, except account close, delete and group delete, which need `accounts:delete`. `write_undo` declares `budget:read` and checks the reversed write's scopes. Its description SHALL name the scopes it needs.

#### Scenario: A tool without a scope fails the build
- **WHEN** a tool is registered without a declared scope
- **THEN** the server's tests fail

#### Scenario: Today's write tools
- **WHEN** a client lists the tools
- **THEN** `write_create_transactions` and `write_update_transactions` need `transactions:write`, `write_set_budget_amount` needs `budget:write`, `write_skip_paycheck` needs `schedules:write`, `write_move_on_budget` and the category create, update and move tools need `structure:write`, and `write_delete_category` and `write_delete_category_group` need `structure:write` and `delete`

### Requirement: Write audit log
The server SHALL append one JSON line per write to its audit log with the time, the acting identity (`user_id` and `subject`), the effective scopes, on the hosted entry a fingerprint of the grants file, the tool, `schema: 2`, the ids and the fields changed with their before and after values, and on an undo `undoes`. It SHALL never log a secret or token. A line without `schema` is version 1 and not undoable.

#### Scenario: An audit line names its identity
- **WHEN** a write tool records an attempt and its outcome
- **THEN** both lines carry `user_id`, the sync-server user id (`unknown` if the server gave none), `subject`, the OAuth subject (`local` on the stdio entry), and `scopes`, the scopes the connection held

#### Scenario: A write is logged
- **WHEN** a client updates one transaction's notes
- **THEN** the log gains one line naming the tool, the transaction id and the notes before and after, and the file mode is 0600

#### Scenario: An undo is logged
- **WHEN** a client undoes a write
- **THEN** the log gains an attempt and an outcome line with `undoes` set to the original `write_id`
