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
`write_undo { write_id }` SHALL reverse the caller's own earlier write by replaying its audit line, not the engine's undo stack. It SHALL first check, with one refusal text for every failure, that the write exists, is the caller's (`subject` and `user_id` both match; `unknown` never matches alone), has `schema: 2`, a clean outcome and an undoable tool. Only then SHALL it check the reversed tool's scopes, taken from a code table keyed by tool, never from the line.

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
- **THEN** both are refused with the same text, with no scope named, and nothing changed

#### Scenario: Not undoable
- **WHEN** a client calls `write_undo` for a write with `applied` null, `read_back` failed, no outcome line, or that is itself a `write_undo`
- **THEN** the call is refused as not undoable and nothing changed

### Requirement: Undo annotations and confirm
`write_undo` SHALL have its own access definition, annotated `readOnlyHint` false and `destructiveHint` true, and SHALL NOT use the read access object. Under `confirm_destructive`, undoing a create SHALL return a dry run naming the rows it would delete and a `confirm`, as in "Confirm before a destructive write"; undoing an update needs none.

#### Scenario: Annotations
- **WHEN** a client lists the tools
- **THEN** `write_undo` is not read-only and is destructive

#### Scenario: Create undo under confirm
- **GIVEN** `confirm_destructive` on and an unchanged created transaction
- **WHEN** the client calls `write_undo` without `confirm`
- **THEN** nothing is deleted and the result lists the row and a `confirm`

### Requirement: Writes are serialized
The server SHALL run write tools and `write_undo` one at a time per process, with one lock taken in the tool wrapper that covers the before-read, the audit attempt line and the write, so a before value cannot be stale when logged.

#### Scenario: Two writes to one row in parallel
- **WHEN** two `write_update_transactions` calls on the same transaction run at once
- **THEN** each logs the value the other left as its before, and undoing the first refuses on conflict

### Requirement: Undo refuses on any conflict
`write_undo` SHALL compare each logged field of each row with the value the write left, and SHALL refuse the whole undo, changing nothing, if any differs, any row is missing, or a created row is in use. A category is in use with a transaction, budget amount, rule or schedule; a group with any category. Untouched fields SHALL NOT be compared. The refusal names row ids and field names only, and says the user can undo by hand.

#### Scenario: A later edit
- **GIVEN** a write that changed 3 transactions' category, and a later edit of one's category
- **WHEN** the client calls `write_undo`
- **THEN** the call is refused naming that transaction and `category`, and all 3 are unchanged

#### Scenario: Another field changed
- **GIVEN** a write that changed notes, and a later change of the same row's cleared flag
- **WHEN** the client calls `write_undo`
- **THEN** the notes are restored and cleared is unchanged

#### Scenario: A used category or group
- **GIVEN** a category created by a write and later assigned to a transaction, and a group created by a write and later given a category
- **WHEN** the client calls `write_undo` for each create
- **THEN** both are refused and both still exist

#### Scenario: Reconciled since
- **GIVEN** a category change on a transaction that was later reconciled
- **WHEN** the client calls `write_undo` without `allow_reconciled`
- **THEN** the call is refused and nothing changed

### Requirement: Undo reads current state
`write_undo` SHALL read a row's reconciled, transfer and split state at undo time, not from the log, and SHALL apply `allow_reconciled` and the transfer and split refusals to the current row.

#### Scenario: A transfer since
- **GIVEN** a payee change on a transaction that was later turned into a transfer
- **WHEN** the client calls `write_undo`
- **THEN** the call is refused as not undoable and nothing changed

### Requirement: What undo reverses
`write_undo` SHALL reverse `write_update_transactions` by restoring the fields, `write_create_transactions` by deleting the created rows, `write_set_budget_amount` by restoring the amount, the category and group update tools by restoring name, hidden and group, and their create tools by deleting while unused. It SHALL replay only allowlisted fields of the ids in `applied` and `created`. It SHALL refuse any other write, an old line, and a current transfer pair or split, with fixed text.

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

### Requirement: An undo is used once it applied
A write SHALL count as undone only after an undo with outcome `ok` or with at least one row applied. A refusal, a conflict, or a failure before the first row SHALL NOT count, so the undo can be retried. A second request for an undone write SHALL be refused naming the undo's `write_id`.

#### Scenario: Retry after a conflict
- **GIVEN** an undo refused on a conflict, which the user then resolved
- **WHEN** the client calls `write_undo` again
- **THEN** it succeeds

#### Scenario: A second undo
- **GIVEN** a write that was already undone
- **WHEN** the client calls `write_undo` for it again
- **THEN** the call is refused naming the undo's `write_id` and nothing changed

### Requirement: Undo reads the audit log safely
`list_writes` and `write_undo` SHALL read at most the last 2 MB of the audit log, drop its cut first line and any line that is not valid JSON, and treat a missing partner line as an unknown id. A write older than the tail SHALL get the unknown-id refusal.

#### Scenario: A damaged line
- **GIVEN** an audit log whose tail has one unparseable line
- **WHEN** the client calls `list_writes`
- **THEN** the other lines are listed and nothing fails

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
