## ADDED Requirements

### Requirement: Payee create tool
`write_create_payee` (`structure:write`) SHALL create a payee from `name` through the engine's payee creation, as the app does, and return `payee_id`, `created` and the name as `text.name` (untrusted text). The name SHALL be trimmed and 1 to 100 characters, or the call is refused with fixed text, changing nothing. The call SHALL be audit-logged with the created id on its outcome line.

#### Scenario: A new lender
- **GIVEN** no payee "Car Loan Co" and a grant with `structure:write`
- **WHEN** a client calls `write_create_payee` with `name` " Car Loan Co "
- **THEN** one payee "Car Loan Co" exists, the result has its id and `created` true, `list_payees` shows it, and the audit log has an attempt and an outcome line

#### Scenario: A bad name
- **WHEN** a client passes an empty name, or one over 100 characters
- **THEN** the call is refused with fixed text, nothing changed, and no audit line is written

### Requirement: Payee names are not duplicated
A name equal, ignoring case, to a live payee SHALL return that payee's id and stored name (`text.name`) with `created` false, writing no row and no audit line. A name equal to a transfer payee's name SHALL be refused, changing nothing.

#### Scenario: The payee already exists
- **GIVEN** a payee "Car Loan Co"
- **WHEN** a client calls `write_create_payee` with "car loan co"
- **THEN** the result is that payee's id and name with `created` false, and no payee or audit line was added

#### Scenario: A transfer payee's name
- **GIVEN** an account "Savings" and so a transfer payee "Transfer: Savings"
- **WHEN** a client creates a payee named "transfer: savings"
- **THEN** the call is refused and nothing changed

### Requirement: Payee create dry run
`write_create_payee` SHALL accept `dry_run: true`, which returns whether it would create a payee and the existing payee's id if there is one, with no `confirm`, and writes nothing, not even an audit line.

#### Scenario: Preview a new lender
- **WHEN** a client calls `write_create_payee` for an unused name with `dry_run` true
- **THEN** the result says it would create the payee, and `list_payees` and the audit log are unchanged

### Requirement: Undo of a payee create
`write_undo` SHALL reverse `write_create_payee` by deleting the created payee while its name is as logged and no transaction, schedule or rule uses it. It SHALL refuse on any other state, naming the conflict, and a write is undone once. A call that returned `created` false has nothing to undo.

#### Scenario: Undo an unused payee
- **GIVEN** a payee created by `write_create_payee` and unused since
- **WHEN** a client calls `write_undo` for it
- **THEN** the payee is gone and the log has an undo line with `undoes`

#### Scenario: Undo a used payee
- **GIVEN** a payee created by `write_create_payee`, then used by a schedule
- **WHEN** a client calls `write_undo` for it
- **THEN** the call is refused as in use and nothing changed

### Requirement: Coverage and scope for the payee tool
`write_create_payee` SHALL declare `structure:write` and its description SHALL name it and say that `write_undo` reverses it. `packages/mcp/coverage.json` SHALL map `payee-create` and `createPayee` to the tool, and `yarn check:mcp-coverage` SHALL pass.

#### Scenario: Without the scope
- **GIVEN** a grant with `budget:read` only
- **WHEN** a client calls `write_create_payee`
- **THEN** the call is refused naming `structure:write`, and nothing changed
