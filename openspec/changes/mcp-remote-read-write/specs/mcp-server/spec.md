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

### Requirement: Write tools
With `--writes`, or on the hosted entry, the server SHALL offer these write tools and no others: `write_create_transactions`, `write_update_transactions` (category, payee, notes), `write_set_budget_amount`, `write_skip_paycheck` and `write_move_on_budget`. It SHALL offer no delete, bulk-edit, import, rule create or edit, account close, or whole-budget reset or transfer.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** none deletes, imports, bulk-edits, edits rules, closes an account or resets a budget

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
