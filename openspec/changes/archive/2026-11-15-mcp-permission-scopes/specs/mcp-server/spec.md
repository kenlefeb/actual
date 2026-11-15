## ADDED Requirements

### Requirement: Every tool declares a scope
Every tool SHALL declare the scopes it needs, chosen from: `budget:read` (every read tool, `sync_budget`, `get_sync_status`, previews), `transactions:write`, `budget:write`, `structure:write` (accounts, categories, payees, tags, rules), `schedules:write` (schedules, paychecks, business calendars) and `delete`. A tool that deletes, closes or merges SHALL need its area's write scope and `delete`. Its description SHALL name the scopes it needs.

#### Scenario: A tool without a scope fails the build
- **WHEN** a tool is registered without a declared scope
- **THEN** the server's tests fail

#### Scenario: Today's write tools
- **WHEN** a client lists the tools
- **THEN** `write_create_transactions` and `write_update_transactions` need `transactions:write`, `write_set_budget_amount` needs `budget:write`, `write_skip_paycheck` needs `schedules:write`, `write_move_on_budget` and the category create, update and move tools need `structure:write`, and `write_delete_category` and `write_delete_category_group` need `structure:write` and `delete`

### Requirement: The tool list does not depend on the grant
Every entry SHALL list every tool, with MCP annotations marking read tools read-only and deleting tools destructive, whatever the connection was granted.

#### Scenario: A read-only connection sees the write tools
- **GIVEN** a connection granted only `budget:read`
- **WHEN** the client lists the tools
- **THEN** the list includes every `write_` tool, and `write_delete_category` is annotated destructive

### Requirement: A call outside the grant is refused by scope
A call whose scopes the connection was not granted SHALL be refused before any budget read, audit attempt line or change, with fixed text naming the tool, the missing scopes and the scopes granted, and ending "Nothing changed." It SHALL never be reported as an unknown tool.

#### Scenario: Delete without the delete scope
- **GIVEN** a connection granted `budget:read structure:write`
- **WHEN** the client calls `write_delete_category`
- **THEN** the call fails with text naming `delete` as missing, and the category still exists

#### Scenario: The same call with the scope
- **GIVEN** a connection granted `budget:read structure:write delete` with `confirm_destructive` off
- **WHEN** the client calls `write_delete_category` for an unused category
- **THEN** the category is deleted

### Requirement: Refusals are audit-logged
A call refused by scope SHALL append one `refused` line to the entry's audit log with the time, identity, tool, missing scopes and granted scopes, and no arguments or budget data. A refusal SHALL stand even when that line cannot be appended.

#### Scenario: A refused write leaves a line
- **WHEN** a connection without `transactions:write` calls `write_update_transactions`
- **THEN** the audit log gains a line with `phase` `refused`, the tool name and `missing` `["transactions:write"]`, and no transaction id

### Requirement: Stdio grants come from the environment
The stdio entry without `--writes` SHALL always grant `budget:read` only and ignore the writes variables. The entry with `--writes` SHALL take its scopes from `ACTUAL_MCP_WRITES_SCOPES` (space-separated), granting every scope when it is unset. It SHALL stop at start with fixed text for an unknown scope, and for a set but empty value, which never counts as unset.

#### Scenario: Today's writes entry keeps its tools
- **WHEN** the stdio entry starts with `--writes` and no `ACTUAL_MCP_WRITES_SCOPES`
- **THEN** every write tool offered before this change still succeeds

#### Scenario: A narrowed writes entry
- **WHEN** the stdio entry starts with `--writes` and `ACTUAL_MCP_WRITES_SCOPES="budget:read transactions:write"`
- **THEN** `write_update_transactions` succeeds and `write_set_budget_amount` is refused by scope

#### Scenario: The read entry shares the env file
- **GIVEN** an env file that sets `ACTUAL_MCP_WRITES_SCOPES="budget:read transactions:write"`
- **WHEN** the stdio entry starts from it without `--writes`
- **THEN** it starts, read tools succeed and every write tool is refused by scope

#### Scenario: An unknown scope on the writes entry
- **WHEN** the stdio entry starts with `--writes` and `ACTUAL_MCP_WRITES_SCOPES="budget:read transactions:everything"`
- **THEN** it exits with a fixed error and opens no budget

#### Scenario: An empty scope list on the writes entry
- **WHEN** the stdio entry starts with `--writes` and `ACTUAL_MCP_WRITES_SCOPES=""`
- **THEN** it exits with a fixed error and opens no budget, rather than granting every scope

### Requirement: Hosted grants come from a grants file
The hosted entry SHALL read grants from the file named by `ACTUAL_MCP_GRANTS_FILE`. Each grant names an OAuth subject, a client id or `*`, its scopes and optional `confirm_destructive` and `max_rows`. The file SHALL be checked on every call, so a change applies on the next call without a restart. An exact client id SHALL take precedence over `*`; a connection with no matching grant SHALL have no scopes.

#### Scenario: A grant change applies on the next call
- **GIVEN** the assistant's grant includes `transactions:write`
- **WHEN** the grants file is replaced with one that removes `transactions:write`, and the client calls `write_update_transactions` with its existing token
- **THEN** the call is refused by scope, without a restart

#### Scenario: A named client gets writes, others read
- **GIVEN** a grant for the subject with client `*` and `budget:read`, and another for the pre-registered client id with `transactions:write`
- **WHEN** a dynamically registered client calls `write_update_transactions`
- **THEN** the call is refused by scope, while the same call from the pre-registered client succeeds

### Requirement: The grants file schema is strict
A grants file SHALL be valid only when `version` is 1, it has no unknown keys, each `scopes` is a non-empty array of known scope names, `max_rows` is a positive integer, `confirm_destructive` is a boolean, `subject` is a literal subject (never a wildcard), no (subject, client) pair appears twice, and every `*` client grant holds `budget:read` only.

#### Scenario: A duplicate pair
- **WHEN** the grants file has two grants for the same subject and client
- **THEN** the file is invalid and every connection is treated as granted `budget:read` only

#### Scenario: Writes on the wildcard client
- **WHEN** the grants file gives client `*` the scope `transactions:write`
- **THEN** the file is invalid and every write tool is refused by scope

#### Scenario: An unknown key
- **WHEN** a grant carries a key `admin: true`
- **THEN** the file is invalid and every write tool is refused by scope

### Requirement: Hosted confirm is on by default
On the hosted entry, a grant without `confirm_destructive` SHALL require confirm before a destructive write; only an explicit `false` turns it off.

#### Scenario: Absent means on
- **GIVEN** a hosted grant with `structure:write delete` and no `confirm_destructive`
- **WHEN** the client calls `write_delete_category` without `confirm`
- **THEN** nothing is deleted and the result is a dry run with a `confirm` value

### Requirement: Hosted grants fail closed
The hosted entry SHALL treat every connection as granted `budget:read` only when the grants file is missing, invalid, a symlink, or writable by the server's process, or its directory is writable by that process. It SHALL read and fingerprint the file through one open descriptor, and record each new fail-closed reason, without file contents, once to stderr.

#### Scenario: No grants file
- **WHEN** the hosted entry runs without a readable grants file
- **THEN** read tools succeed and every write tool is refused by scope

#### Scenario: A grants file the server could rewrite
- **GIVEN** a grants file the server's user can write
- **WHEN** a client calls a write tool
- **THEN** the call is refused by scope and stderr records that the grants file is writable

#### Scenario: A directory the server can write
- **GIVEN** a root-owned, mode 0644 grants file in a directory the server's user can write
- **WHEN** a client calls a write tool
- **THEN** the call is refused by scope and stderr records that the grants directory is writable

#### Scenario: A symlinked grants file
- **GIVEN** `ACTUAL_MCP_GRANTS_FILE` names a symlink to a valid grants file
- **WHEN** a client calls a write tool
- **THEN** the call is refused by scope

### Requirement: The token scope admits, the grant permits
The hosted entry's access tokens SHALL keep the single scope `budget:read`, which admits a connection to the endpoint. What the connection may call SHALL come only from its grant, so a grant change needs no new sign-in.

#### Scenario: An existing connection gains writes
- **GIVEN** a token issued before this change, with scope `budget:read`
- **WHEN** the subject's grant adds `transactions:write` and the client calls `write_update_transactions`
- **THEN** the call succeeds without reconnecting

### Requirement: Confirm before a destructive write
With `confirm_destructive` on, a destructive tool called without `confirm` SHALL change nothing and return what it would change with a `confirm` value bound to the caller, valid for 5 minutes. A call with `confirm` SHALL run only if the caller matches, the value has not expired and recomputing gives the same changes.

#### Scenario: Dry run then confirm
- **GIVEN** a grant with `structure:write delete` and `confirm_destructive`
- **WHEN** the client calls `write_delete_category` without `confirm`, then again with the returned `confirm`
- **THEN** the first call changes nothing and returns the category and `confirm`, and the second deletes it

#### Scenario: A stale confirm
- **GIVEN** a `confirm` from a dry run of deleting an unused category
- **WHEN** a transaction is assigned that category and the client calls with the old `confirm`
- **THEN** the call is refused and the category still exists

#### Scenario: An expired confirm
- **GIVEN** a `confirm` from a dry run more than 5 minutes ago, with the budget unchanged
- **WHEN** the client calls with that `confirm`
- **THEN** the call is refused and nothing changed

### Requirement: A grant can lower the row cap
A grant's `max_rows` SHALL lower the per-call row limit below 50 for that connection, and SHALL never raise it.

#### Scenario: Lowered cap
- **GIVEN** a grant with `max_rows` 10
- **WHEN** the client calls `write_update_transactions` with 11 ids
- **THEN** the call fails and no transaction changed

## RENAMED Requirements

- FROM: `### Requirement: Read-only unless writes are turned on`
- TO: `### Requirement: A grant decides what a connection may do`

## MODIFIED Requirements

### Requirement: A grant decides what a connection may do
Every entry SHALL list the read tools and the `write_` tools; the connection's grant decides which calls succeed. Write tools SHALL carry the prefix `write_`. The stdio entry started without `--writes` SHALL open the budget with `readOnly` and grant no write scope, so it writes and pushes nothing.

#### Scenario: Reads only by default
- **WHEN** a client calls a `write_` tool on a server started without `--writes`
- **THEN** the call is refused by scope and the budget is unchanged

#### Scenario: Writes on a separate entry
- **WHEN** a client lists the tools of a server started with `--writes` on a `staging` host
- **THEN** it lists the read tools and the `write_` tools, and the calls its grant covers succeed

#### Scenario: The writes entry runs the engine normally
- **WHEN** the server is started with `--writes` on a `staging` host
- **THEN** the budget is opened without `readOnly`, so the engine keeps its normal behavior there, while a server started without `--writes` opens it with `readOnly`

### Requirement: Core read tools
The server SHALL offer read tools for accounts and balances, category groups and categories, payees, transactions, budget months, schedules, rules, a read-only ActualQL query and `sync_budget`. Every entry SHALL also list the write tools, and the connection's grant decides which calls succeed. The read entry SHALL open the budget read-only (`api-read-only-mode`), so a sync writes nothing locally and pushes nothing.

#### Scenario: Transactions from a fixture budget
- **GIVEN** a fixture budget with 120 transactions in "Checking"
- **WHEN** a client calls `list_transactions` with Checking's `account_id` and no limit
- **THEN** it receives 50 transactions, `has_more` true and a `next_cursor`

#### Scenario: A read entry writes nothing
- **GIVEN** a budget with an auto-post schedule that is due today and paycheck edits that arrive by sync
- **WHEN** the server starts without `--writes` and the client calls `sync_budget`
- **THEN** no transaction was created in the local copy, the sync server received no messages from this client, and no budget file was uploaded

#### Scenario: A query that is not a select
- **WHEN** a client calls `run_query` with a query that would change data
- **THEN** the call fails and the budget is unchanged

### Requirement: Write tools
The server SHALL offer the write tools `write_create_transactions`, `write_update_transactions` (category, payee, notes), `write_set_budget_amount`, `write_skip_paycheck`, `write_move_on_budget` and the category maintenance tools of "Category maintenance tools", and any write tool added later, each with its declared scopes. A tool SHALL NOT be left out or hidden to limit what an agent may do; that limit is the grant.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** every deleting tool is annotated destructive and needs the `delete` scope

### Requirement: Write audit log
The server SHALL append one JSON line per write to `~/Library/Application Support/actual-mcp/<env>.audit.jsonl` (`<env>-writes.audit.jsonl` for the `--writes` entry, `<env>-remote.audit.jsonl` for the hosted entry), mode 0600, with the time, the acting identity (`user_id` and `subject`), the effective scopes, on the hosted entry a fingerprint of the grants file, tool, ids and the fields changed with their before and after values, and never a secret or token. A write SHALL NOT run when its audit line cannot be appended.

#### Scenario: An audit line names its identity
- **WHEN** a write tool records an attempt and its outcome
- **THEN** both lines carry `user_id`, the sync-server user id (`unknown` if the server gave none), `subject`, the OAuth subject (`local` on the stdio entry), and `scopes`, the scopes the connection held

#### Scenario: A write is logged
- **WHEN** a client updates one transaction's notes
- **THEN** the log gains one line naming the tool, the transaction id and the notes before and after, and the file mode is 0600

#### Scenario: The log can't be written
- **GIVEN** the audit log's directory is read-only
- **WHEN** a client calls a write tool
- **THEN** the call fails and the budget is unchanged
