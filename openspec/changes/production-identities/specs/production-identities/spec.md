# Spec Delta

## ADDED Requirements

### Requirement: Production signs in only through OpenID
The production sync server SHALL run in OpenID multi-user mode with password login disabled, so that no shared password opens a budget. Ken SHALL be its only ADMIN. The assistant SHALL be a BASIC user. No other person, agent or service SHALL have a production user, and no account the assistant uses SHALL be an ADMIN. The production password is the one carve-out (see the scenario on the drill).

#### Scenario: The shared password no longer works
- **GIVEN** production is switched to OpenID with password login off
- **WHEN** a client posts the old server password to the login endpoint
- **THEN** the server refuses it and issues no session

#### Scenario: The password is only a drill and break-glass credential
- **WHEN** the restore drill runs
- **THEN** its container listens on loopback only, signs in with the password row, and is destroyed afterwards, and the password stays in Ken's Private item "Actual (Production) login" as the break-glass credential

#### Scenario: The assistant is not an administrator
- **WHEN** the assistant's session lists budgets
- **THEN** it sees only the budgets Ken shared with it, and the admin write routes (creating users, disabling OpenID) refuse it

#### Scenario: Development agents have no production user
- **WHEN** the production user list is reviewed
- **THEN** it holds Ken and the assistant and nobody else

### Requirement: Turning the password off survives reinstalls and ends old sessions
`ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` SHALL be set in production's root-owned compose template, from which every promote and reinstall builds, and not only as one-off settings or in the database. The switch SHALL delete every session whose `auth_method` is `password` and verify that none remain. Both variables SHALL be in the LOCKDOWN inventory and the persistence check.

#### Scenario: A password session from before the switch is refused
- **GIVEN** a session token issued by password login before the switch
- **WHEN** it is used after the switch
- **THEN** the server refuses it, and the `sessions` table holds no row with `auth_method = 'password'`

#### Scenario: A post-switch snapshot stays refused
- **GIVEN** a snapshot made after the switch is restored over production
- **WHEN** the server starts from the template with the two variables set
- **THEN** a password login is refused

#### Scenario: A pre-switch snapshot is restored
- **GIVEN** a snapshot made before the switch (it has only the password method)
- **WHEN** it is restored over production
- **THEN** the restore re-applies the switch (`enable-openid.js` run offline on the volume, and the sessions table in the restored copy deleted) before the server is reachable, and a password login is refused afterwards

#### Scenario: A restore under OpenID
- **GIVEN** a snapshot is restored, before or after the switch
- **WHEN** the restore finishes
- **THEN** every session is deleted and the assistant's token is minted again, so no token revoked since the snapshot works

#### Scenario: A template change is caught
- **WHEN** the persistence check runs and the template lacks either variable
- **THEN** the check fails

### Requirement: The first sign-in is Ken's
The identity provider SHALL be an Auth0 tenant that holds only Ken's account and the assistant's account, with sign-ups off and no social or enterprise connection enabled, so that it accepts no other identity. The first OpenID sign-in on a server with no OpenID user SHALL be Ken's, made before the server is reachable by anyone else or while `ACTUAL_OPENID_ENFORCE` is off, because with it on the server asks for no password and gives ADMIN and ownership to the first identity the provider accepts.

#### Scenario: An unrelated identity cannot claim the server
- **GIVEN** OpenID is enabled and no OpenID user exists
- **WHEN** an identity that is not Ken's finishes the provider's sign-in
- **THEN** the provider refuses it

### Requirement: The server refuses a first sign-in that is not Ken's
When `ACTUAL_OPENID_ADMIN_SUBJECT` is set, the sync server SHALL accept the first OpenID sign-in on a server with no OpenID user only if the provider's `sub` equals it, and SHALL otherwise refuse it and create no user. Production SHALL set it to Ken's `sub`. It needs a provider that returns a `sub`; a plain OAuth2 provider without one cannot use the backstop and is refused.

#### Scenario: The match is on the subject, not the e-mail
- **GIVEN** the setting is Ken's `sub` and Ken's e-mail later changes
- **WHEN** Ken signs in for the first time
- **THEN** he is accepted, because the `sub` is matched and the e-mail is not

#### Scenario: Unset keeps upstream behaviour
- **GIVEN** the setting is unset
- **WHEN** OpenID is enabled and the first identity signs in
- **THEN** it becomes ADMIN as upstream does, and the server logs a warning at enablement

#### Scenario: Later sign-ins are not affected
- **GIVEN** an OpenID user exists
- **WHEN** any listed user signs in
- **THEN** the setting is not consulted

#### Scenario: An empty identity cannot reach the password user
- **GIVEN** the setting is set and the provider returns an empty user name
- **WHEN** the sign-in is finished
- **THEN** the server refuses it, because an empty name would otherwise resolve to the password-method ADMIN

#### Scenario: A mismatched ID token is refused
- **GIVEN** the setting is set and the ID token's `sub` differs from the userinfo `sub`
- **WHEN** the sign-in is finished
- **THEN** the server refuses it

#### Scenario: A first sign-in from another identity is refused
- **GIVEN** OpenID is enabled, `ACTUAL_OPENID_ADMIN_SUBJECT` is Ken's `sub` and no OpenID user exists
- **WHEN** an identity with another `sub` finishes the provider's sign-in
- **THEN** the server refuses it, creates no user and issues no session

#### Scenario: Ken's first sign-in still works
- **GIVEN** the same setting
- **WHEN** Ken's identity finishes the provider's sign-in
- **THEN** he becomes ADMIN and owner

### Requirement: The assistant has its own sign-in identity
The assistant's BASIC user SHALL be a dedicated account in the Auth0 tenant, not Ken's, protected by a passkey or authenticator-app two-factor sign-in, with no account recovery through any mailbox agents can read. Its credentials SHALL be kept in the "Ken Assistant" vault and listed in the LOCKDOWN inventory.

#### Scenario: Recovery does not reach agent-readable mail
- **WHEN** the assistant's account recovery options are reviewed
- **THEN** none sends a link or code to Ken's mailbox

### Requirement: Ken's ADMIN identity is as protected as the assistant's
Ken's account in the same tenant SHALL meet the same two-factor and recovery rules, because the first OpenID sign-in on the server becomes ADMIN. Ken's ADMIN credentials, recovery codes and second factor SHALL NOT be stored in "Ken & Agents" or in any other vault an agent can read.

#### Scenario: Ken's credentials are not in an agent-readable vault
- **WHEN** every vault an agent can read is searched for Ken's ADMIN credentials, recovery codes and second factor
- **THEN** none is found

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
The assistant's connector SHALL sign in to production with a session token that Ken mints once through the OpenID flow, kept in its 0400 file, and not with a password. The token SHALL end after a stated period set through `token_expiration` for the minting (the server default is `never`), and SHALL be revocable at once by disabling the assistant's user through the admin route, which deletes its sessions. It SHALL be minted only after staging has shown a headless BASIC sign-in with such a token.

#### Scenario: Disabling the user ends the token
- **GIVEN** the connector holds a valid token
- **WHEN** Ken sets the assistant's user to disabled
- **THEN** the next request with that token is refused

#### Scenario: Minting does not change Ken's sessions
- **GIVEN** `token_expiration` is a server-wide setting stored per session at sign-in
- **WHEN** Ken has minted the assistant's token with it set and has unset it
- **THEN** a new ADMIN session gets the default lifetime and the assistant's token keeps its own end date

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
Development agent sessions SHALL run without Ken's claude.ai connectors and without his local Claude Desktop MCP entries for production. Where Claude Code supports it, agent sessions SHALL deny the Actual connectors by URL pattern, and the local `actual-production` entry by name, with `deniedMcpServers` in the committed project settings, leaving other connectors available; whether that is enough SHALL be verified by listing a fresh agent session's tools. If it is not enough, agents SHALL run under a separate Anthropic account or seat.

#### Scenario: A fresh agent session lists no production tools
- **WHEN** a development agent session starts and lists its tools
- **THEN** it lists no production connector and no `actual-production` entry

### Requirement: Every request is attributable to an identity
Every MCP audit line (attempt and outcome) and every read of a budget SHALL record the acting identity: the authenticated sync-server user id and, for the hosted entry, the OAuth subject. The sync server SHALL log, per request that touches a budget, the user id, the file id, the HTTP method, the route, the response status and the time, and never budget content or a token. Both logs SHALL be copied off the host to a place agents and the VPS cannot rewrite, kept at least 90 days.

#### Scenario: An audit line names its identity
- **WHEN** a write tool records an attempt
- **THEN** the line carries the user id and the OAuth subject (or `local` for the stdio entry)

#### Scenario: The access log holds no content
- **WHEN** the sync server serves a sync request
- **THEN** its log line has the user id, file id, method, route, status and time and nothing from the budget or the token

### Requirement: LOCKDOWN comes first
No vault separation SHALL be counted as real separation, and no production credential SHALL be minted or installed, until the LOCKDOWN checklist has removed agents' root on the VPS (sc-563), because root can read the host's 0400 file and the sync server's volume.

#### Scenario: The ordering is enforced by the checklist
- **WHEN** Ken's production-switch checklist is reviewed
- **THEN** its first step confirms LOCKDOWN is done, and a later step is blocked until it is

### Requirement: Switching does not break backup and restore
The switch SHALL list every use of the production password and what replaces it, and SHALL leave the nightly backup and the Mac mini pull unchanged (SSH forced command and age key, no login). A restore onto production SHALL, before the server is reachable, delete the sessions table in the restored copy and run `enable-openid.js` offline; that step is to be scripted, not left as prose.

#### Scenario: Every password use is listed
- **WHEN** the design's table of password uses is reviewed
- **THEN** it names the drill, the snapshot restore, LOCKDOWN, the backup tooling, the promote health check, the staging scripts and the MCP entries, each with what replaces the password or why it is unchanged
