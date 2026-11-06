## ADDED Requirements

### Requirement: Host allowlist
The server SHALL label the environment from the server URL's host: `actual-staging.owl-becrux.ts.net` is `staging`; `localhost`, `127.0.0.1` and `[::1]` are `local`; any other host is `production`. It SHALL refuse to start for `production` unless `ACTUAL_MCP_ALLOW_PRODUCTION=1` is set.

#### Scenario: Production is refused by default
- **GIVEN** `ACTUAL_SERVER_URL` names any host not in the allowlist and `ACTUAL_MCP_ALLOW_PRODUCTION` is unset
- **WHEN** the server starts
- **THEN** it exits before it signs in, with a fixed message that names the rule and not the credentials

#### Scenario: Production allows writes when allowed
- **GIVEN** `ACTUAL_MCP_ALLOW_PRODUCTION=1` and a production host
- **WHEN** the server starts with `--writes`
- **THEN** it starts with the write tools and its `production-writes` data directory, as on any other host

#### Scenario: A look-alike host
- **GIVEN** `ACTUAL_SERVER_URL` is `https://actual-staging.owl-becrux.ts.net.evil.example`
- **WHEN** the server starts
- **THEN** it is labelled `production` and refused

## MODIFIED Requirements

### Requirement: Read-only unless writes are turned on
The server SHALL offer read tools only unless it is the stdio entry started with `--writes` or the hosted entry. Write tools SHALL carry the prefix `write_`, and SHALL NOT be registered at all on the stdio entry without the flag.

#### Scenario: Reads only by default
- **WHEN** a client lists the tools of a server started without `--writes`
- **THEN** no tool name starts with `write_`

#### Scenario: Writes on a separate entry
- **WHEN** a client lists the tools of a server started with `--writes` on a `staging` host
- **THEN** it lists the read tools and the `write_` tools

#### Scenario: The writes entry runs the engine normally
- **WHEN** the server is started with `--writes` on a `staging` host
- **THEN** the budget is opened without `readOnly`, so the engine keeps its normal behavior there, while a server started without `--writes` opens it with `readOnly`

### Requirement: Core read tools
The server SHALL offer read tools for accounts and balances, category groups and categories, payees, transactions, budget months, schedules, rules, a read-only ActualQL query and `sync_budget`, and no write tools unless it is the stdio entry started with `--writes` or the hosted entry. The read entry SHALL open the budget read-only (`api-read-only-mode`), so a sync writes nothing locally and pushes nothing.

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
With `--writes`, or on the hosted entry, the server SHALL offer these write tools and no others: `write_create_transactions`, `write_update_transactions` (category, payee, notes), `write_set_budget_amount`, `write_skip_paycheck`, `write_move_on_budget` and the category maintenance tools of "Category maintenance tools". It SHALL offer no delete other than those, and no bulk-edit, import, rule create or edit, account close, or whole-budget reset or transfer.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** the only deleting tools are `write_delete_category` and `write_delete_category_group`, and none imports, bulk-edits, edits rules, closes an account or resets a budget

### Requirement: Write audit log
The server SHALL append one JSON line per write to `~/Library/Application Support/actual-mcp/<env>.audit.jsonl` (`<env>-writes.audit.jsonl` for the `--writes` entry, `<env>-remote.audit.jsonl` for the hosted entry), mode 0600, with the time, the acting identity (`user_id` and `subject`), tool, ids and the fields changed with their before and after values, and never a secret or token. A write SHALL NOT run when its audit line cannot be appended.

#### Scenario: An audit line names its identity
- **WHEN** a write tool records an attempt and its outcome
- **THEN** both lines carry `user_id`, the sync-server user id (`unknown` if the server gave none), and `subject`, the OAuth subject (`local` on the stdio entry)

#### Scenario: A write is logged
- **WHEN** a client updates one transaction's notes
- **THEN** the log gains one line naming the tool, the transaction id and the notes before and after, and the file mode is 0600

#### Scenario: The log can't be written
- **GIVEN** the audit log's directory is read-only
- **WHEN** a client calls a write tool
- **THEN** the call fails and the budget is unchanged

## REMOVED Requirements

### Requirement: Server allowlist
**Reason**: It kept production read-only. Ken decided on 2026-11-05 (sc-2486) that production is read-write; "Host allowlist" keeps the same labels and refusal without that rule.
**Migration**: None. `--writes` now works on a production host that `ACTUAL_MCP_ALLOW_PRODUCTION=1` allows.
