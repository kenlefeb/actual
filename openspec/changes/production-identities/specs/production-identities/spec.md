# Spec Delta

## ADDED Requirements

### Requirement: Production signs in only through OpenID
The production sync server SHALL run in OpenID multi-user mode with password login disabled, so that no shared password opens a budget. Ken SHALL be its only ADMIN. The assistant SHALL be a BASIC user. No other person, agent or service SHALL have a production user, and no account the assistant uses SHALL be an ADMIN.

#### Scenario: The shared password no longer works
- **GIVEN** production is switched to OpenID with password login off
- **WHEN** a client posts the old server password to the login endpoint
- **THEN** the server refuses it and issues no session

#### Scenario: The assistant is not an administrator
- **WHEN** the assistant's session lists budgets
- **THEN** it sees only the budgets Ken shared with it, and the admin-only user routes refuse it

#### Scenario: Development agents have no production user
- **WHEN** the production user list is reviewed
- **THEN** it holds Ken and the assistant and nobody else

### Requirement: Turning the password off survives reinstalls and ends old sessions
`ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` SHALL be set in production's root-owned compose template, from which every promote and reinstall builds, and not only as one-off settings or in the database. The switch SHALL delete every session whose `auth_method` is `password` and verify that none remain. Both variables SHALL be in the LOCKDOWN inventory and the persistence check.

#### Scenario: A password session from before the switch is refused
- **GIVEN** a session token issued by password login before the switch
- **WHEN** it is used after the switch
- **THEN** the server refuses it, and the `sessions` table holds no row with `auth_method = 'password'`

#### Scenario: A restored password row stays refused
- **GIVEN** a snapshot made before the switch is restored over production
- **WHEN** the server starts from the template with the two variables set
- **THEN** a password login is refused until the switch is re-applied

#### Scenario: A template change is caught
- **WHEN** the persistence check runs and the template lacks either variable
- **THEN** the check fails

### Requirement: The assistant has its own sign-in identity
The assistant's BASIC user SHALL be a dedicated account at the configured identity provider, not Ken's, protected by a passkey or authenticator-app two-factor sign-in, with no account recovery through any mailbox agents can read. Its credentials SHALL be kept in the "Ken Assistant" vault and listed in the LOCKDOWN inventory.

#### Scenario: Recovery does not reach agent-readable mail
- **WHEN** the assistant's account recovery options are reviewed
- **THEN** none sends a link or code to Ken's mailbox

### Requirement: The assistant sees only the budgets it is given
The assistant's user SHALL have access (an owner or `user_access` row) to exactly the budgets named in the migration checklist, and the budget's end-to-end encryption key SHALL be known only to Ken and the assistant's connector.

#### Scenario: An unshared budget is invisible
- **GIVEN** Ken has two budgets and shares one with the assistant
- **WHEN** the assistant's session lists budgets or syncs the other one
- **THEN** the list omits it and the sync is refused

### Requirement: One rule for where the credential lives
The assistant's production credential SHALL have one record and one deployed copy: a 1Password item in a vault named "Ken Assistant" that only Ken's interactive 1Password reads (no service account, no CLI integration, no copy on the Mac's disk or in a keychain), and a root-owned mode 0400 file on the production host mounted into the hosted connector's container. The "Ken & Agents" vault SHALL hold staging credentials only, and no production credential of the assistant or of an ADMIN.

#### Scenario: Agents cannot read the production credential
- **WHEN** a development agent session lists "Ken & Agents" and its own environment
- **THEN** neither holds a production session token, encryption key, or admin credential

#### Scenario: The host copy is the only deployed one
- **WHEN** the checklist's inventory step lists where the assistant's token exists
- **THEN** it finds the vault item and the container's 0400 file, and no other copy

### Requirement: Headless sign-in with a long-lived token Ken mints
The assistant's connector SHALL sign in to production with a session token that Ken mints once through the OpenID flow, stored in the connector's 0400 file, with `token_expiration` set so it outlives the 10-minute default by a stated period, and SHALL be revocable at once by disabling the assistant's user. The token SHALL be minted only after staging has shown that `@actual-app/api` signs in headless as a BASIC user with such a token.

#### Scenario: Disabling the user ends the token
- **GIVEN** the connector holds a valid token
- **WHEN** Ken sets the assistant's user to disabled
- **THEN** the next request with that token is refused

#### Scenario: Minting does not lengthen Ken's sessions
- **GIVEN** `token_expiration` is a server-wide setting
- **WHEN** Ken has minted the assistant's token with it raised and has put it back
- **THEN** a new ADMIN session gets the default lifetime

#### Scenario: Staging proves the sign-in first
- **WHEN** the production switch is proposed
- **THEN** the staging rehearsal's record shows a headless BASIC sign-in with a minted token and a refused password login

### Requirement: The assistant reaches production only through the hosted connector
The assistant SHALL read production only through the hosted connector (the production slice of `mcp-remote`), read-only by default. The local `actual-production` entry SHALL be removed from Claude Desktop, and no production credential SHALL be left in a local launcher.

#### Scenario: No local production entry
- **WHEN** a Claude Code session in the repository lists its MCP tools
- **THEN** none is named `actual-production` or reaches a production host

### Requirement: Development agents stay on staging
Development agents SHALL work against staging and synthetic data only. Production data needed to reproduce a defect SHALL come from a restored backup copy on a throwaway staging instance with Ken's approval, never from a production sign-in. Read-only for development agents on production is not promised, because the server has no read-only grant.

#### Scenario: A defect needs production data
- **WHEN** a defect cannot be reproduced on synthetic data
- **THEN** the checklist's break-glass step restores a backup to a throwaway staging instance and Ken approves it first

#### Scenario: The break-glass copy is destroyed
- **WHEN** the defect is resolved
- **THEN** the checklist's last step destroys the restored copy and Ken checks it off

### Requirement: Agent sessions do not carry the assistant's tools
Development agent sessions SHALL run without Ken's claude.ai connectors and without his local Claude Desktop MCP entries for production. Where Claude Code supports it, agent sessions SHALL set `ENABLE_CLAUDEAI_MCP_SERVERS=false`; whether that is enough SHALL be verified by listing a fresh agent session's tools. If it is not enough, agents SHALL run under a separate Anthropic account or seat.

#### Scenario: A fresh agent session lists no production tools
- **WHEN** a development agent session starts and lists its tools
- **THEN** it lists no production connector and no `actual-production` entry

### Requirement: Every request is attributable to an identity
Every MCP audit line (attempt and outcome) and every read of a budget SHALL record the acting identity: the authenticated sync-server user id and, for the hosted entry, the OAuth subject. The sync server SHALL log, per request that touches a budget, the user id, the file id, the route and the time, and never budget content or a token. Both logs SHALL be copied off the host to a place agents and the VPS cannot rewrite, kept at least 90 days.

#### Scenario: An audit line names its identity
- **WHEN** a write tool records an attempt
- **THEN** the line carries the user id and the OAuth subject (or `local` for the stdio entry)

#### Scenario: The access log holds no content
- **WHEN** the sync server serves a sync request
- **THEN** its log line has the user id, file id, route and time and nothing from the budget or the token

### Requirement: LOCKDOWN comes first
No vault separation SHALL be counted as real separation, and no production credential SHALL be minted or installed, until the LOCKDOWN checklist has removed agents' root on the VPS (sc-563), because root can read the host's 0400 file and the sync server's volume.

#### Scenario: The ordering is enforced by the checklist
- **WHEN** Ken's production-switch checklist is reviewed
- **THEN** its first step confirms LOCKDOWN is done, and a later step is blocked until it is

### Requirement: Switching does not break backup and restore
The switch SHALL list every use of the production password and what replaces it, SHALL rehearse a restore onto a staging instance with OpenID on, and SHALL leave the nightly ciphertext backup and the Mac mini pull unchanged because they use SSH forced commands and an age key, not a login.

#### Scenario: A restore under OpenID
- **GIVEN** an archive made after the switch
- **WHEN** the restore drill runs on a staging instance with OpenID on
- **THEN** Ken signs in through the identity provider and sees the budget

#### Scenario: A pre-switch snapshot is restored
- **GIVEN** a snapshot made before the switch
- **WHEN** it is restored over production
- **THEN** password login is refused from the first start because the template still sets the two variables, and the checklist's next step re-applies the switch (including deleting password sessions) before anyone signs in
