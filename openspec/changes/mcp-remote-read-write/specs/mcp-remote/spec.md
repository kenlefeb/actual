## ADDED Requirements

### Requirement: A separate read-write hosted entry
The hosted server SHALL be its own entry, apart from the stdio entry, that serves the same tools as the stdio `--writes` entry over stateless streamable HTTP. It SHALL listen only on its configured address (loopback by default), and the stdio entry SHALL stay unchanged and listener-free.

#### Scenario: The stdio entry still opens no listener
- **WHEN** the `actual-mcp` stdio entry is running
- **THEN** it has no listening socket, as before

#### Scenario: The hosted entry serves the writes entry tools
- **WHEN** an authorized client lists the hosted entry's tools
- **THEN** it lists the read tools and the `write_` tools of the stdio `--writes` entry and `get_sync_status`, and no others

#### Scenario: A hosted write is audited with its OAuth subject
- **WHEN** an authorized client calls a write tool
- **THEN** the hosted entry's audit log gains an attempt and an outcome line carrying the caller's OAuth subject

#### Scenario: A hosted sync runs the engine as the app does
- **WHEN** the hosted entry opens its budget
- **THEN** it opens it without `readOnly`, so writes sync and push like the app's

### Requirement: Production under an identity guard
The hosted entry SHALL serve a `production` host only with `ACTUAL_MCP_REMOTE_PRODUCTION=1` (the stdio `ACTUAL_MCP_ALLOW_PRODUCTION` does not count), a session token file whose user is exactly BASIC (never ADMIN), a provider subject identifier (no `@`) as the account and the `production-remote` data directory; otherwise it SHALL exit with a fixed error before it listens. Production is read-write like staging.

#### Scenario: Production without the flag
- **GIVEN** `ACTUAL_SERVER_URL` names a host labelled `production` and only `ACTUAL_MCP_ALLOW_PRODUCTION=1` is set
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error before it signs in or listens

#### Scenario: Production with a password
- **GIVEN** the production flag is set and `ACTUAL_PASSWORD_FILE` is set instead of a session token
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the secret

#### Scenario: Production with an email as the account
- **GIVEN** the production flag and a session token are set and the allowed account is an email address
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error

#### Scenario: Production with an administrator's token
- **GIVEN** every other guard condition is met and the session token belongs to an ADMIN user
- **WHEN** the hosted entry starts
- **THEN** it exits with a fixed error that does not name the token, before it listens

#### Scenario: Production with the guard met
- **GIVEN** the flag, a 0400 session token file, a subject identifier as the account and every other required setting
- **WHEN** the hosted entry starts
- **THEN** it serves the production budget through the read and write tools, with its audit log at `production-remote.audit.jsonl`

## REMOVED Requirements

### Requirement: Hosted means read-only, in code
**Reason**: Ken decided on 2026-11-05 (sc-2486) that the hosted connector is read-write, production included, until there are paying customers.
**Migration**: None. The hosted entry takes no arguments, so `--writes` is still a usage error; writes need no flag. Hardening is sc-2426.

### Requirement: A separate hosted entry
**Reason**: It served the read tools only; replaced by "A separate read-write hosted entry" (sc-2486).
**Migration**: None.

### Requirement: Production only under an explicit guard
**Reason**: It kept production read-only; replaced by "Production under an identity guard", which keeps every identity check (sc-2486).
**Migration**: None.
