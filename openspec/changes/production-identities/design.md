# Design

## Context

See proposal.md (Why). Findings: sc-2004 comments 2005 (Security Analyst), 2006 (Architect) and 2007 (PO decision). This change is slice 1: the spec and the design, with no code and no production touch. The slices are filed when it merges.

Facts the design rests on (read from `packages/sync-server` and `packages/mcp`; the ones marked "to verify" are settled by slice C on staging, not assumed):
- **One active login method.** The `auth` table has one active row; enabling OpenID makes it active. The password row can stay in the table, and `POST /login` accepts a `loginMethod` the client names if `allowedLoginMethods` (env `ACTUAL_ALLOWED_LOGIN_METHODS`, default `password,header,openid`) includes it and the row exists. So switching is not enough: production also sets `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true`, and the rehearsal proves the old password is refused (a "to verify" item).
- **Users.** `users.role` is `ADMIN` or `BASIC`; the first OpenID user becomes ADMIN and owner; `enabled = 0` makes `getSession` find no session for that user.
- **Per-budget access.** `files.owner` plus `user_access`. Every sync and file route runs `requireFileAccess`; `/list-user-files` shows a BASIC user only owned and granted budgets. An ADMIN reaches every budget.
- **No read-only grant.** A `user_access` row allows read and write. "Read-only" is client-side: `init({ readOnly: true })` and the hosted entry's lack of write tools. A leaked assistant token with access can write.
- **Session lifetime.** An OpenID session lasts 10 minutes unless `token_expiration` says otherwise (`never`, seconds, or `openid-provider`). `@actual-app/api` accepts a `sessionToken` in `init` (see `api-read-only-mode` and its session test), which is how a headless connector can use a minted token (to verify against an OpenID server).
- **Encryption is a second key.** A user with file access but without the budget's encryption password cannot read an encrypted budget.
- **Audit today.** `appendAudit` lines carry time, tool, call id, ids and changes, no identity; the sync server only uses `console.log`; the `sessions` table records `user_id` and `auth_method` per token.
- **LOCKDOWN today** (actual-hosting `production/LOCKDOWN.md`): agents hold root on the VPS until Ken's step 3; the production password was to be rotated into the Private item "Actual (Production) login" (4a) and the item in "Ken & Agents" deleted (4d); the Mac mini pulls age-encrypted backups with a forced-command key and logs in to nothing.

## Decisions

### 1. Identities
Three kinds, no more. Ken is ADMIN through his own identity at the identity provider, protected by a passkey or second factor and never by an emailed link (agents can read his mail). The assistant is one BASIC user. Development agents have none on production. The identity provider, its client registration and callback are configuration (like `mcp-remote`); Ken's choice is open and is needed before slice C.

### 2. One rule for the credential
The record is a 1Password item in a new vault, "Ken Assistant", that only Ken's interactive 1Password opens: no service account (its token would sit in a keychain any process running as Ken can ask for), no CLI integration (it stays off, see sc-696), no file on the Mac. The only deployed copy is the connector's root-owned 0400 file on the host, drawn from the item by Ken at install time. Rotation replaces both. "Ken & Agents" keeps staging credentials only: the staging promote token, the staging SSH key, staging passwords and age identity. Ken's Private vault keeps his own production admin items ("Actual (Production) login", the backup recovery key).

Why not "no vault, file only": the file is lost with the host; the record lets Ken re-mint after a restore.

### 3. The password users, and what replaces them
Moving production to OpenID retires the shared password for everyone. Each place that uses it:

| Use today | After the switch |
|---|---|
| Ken's browser sign-in (`production/README.md`, Ken's phone and laptop) | Sign in through the identity provider as Ken (ADMIN). |
| `RESTORE.md` restore drill and snapshot restore ("sign in with the production password that was current when the archive was made") | Sign in through the identity provider. The drill and the restore are rehearsed on a staging instance with OpenID on (slice C). A snapshot older than the switch brings the password mode and users back: the restore step re-checks the login mode and re-applies the switch before anyone signs in. |
| `LOCKDOWN.md` 4a (change server password in the app, console `reset-password.js`) | These apply to password mode only. After the switch the equivalent is revoking the assistant (set the user to disabled) or re-minting the token; the LOCKDOWN checklist notes the change when slice E lands. `reset-password.js` stays as the recovery path if the identity provider is lost (re-enabling password login is a console step Ken approves). |
| The nightly backup, the Mac mini pull, `export-backup.py`, `prune-backups.py`, `pull-backup.py` | Unchanged: they use an SSH forced command and an age key, not a login. |
| Promotes (`promote.py`) and the health check | Unchanged unless a health check signs in; slice C lists it. |
| Staging scripts (`agent.cjs`, `existing-client-sync.cjs`, `fixture.cjs`) | Stay on password mode on staging. Staging runs OpenID only for the rehearsal instance. |
| The stdio MCP entry's `ACTUAL_PASSWORD` | Stays for staging. For production it is replaced by the connector's session token (decision 4); the stdio entry stays refused for production. |

### 4. Headless sign-in: a token Ken mints
Option (a) from the Architect's comment: Ken signs in once through the OpenID flow as the assistant's user to mint a session token, kept in the connector's 0400 file, with `token_expiration` raised for that session to a stated period (the default for this change is 30 days with a calendar reminder in the checklist; the period is configuration). Revocation is `enabled = 0`. Rejected for now: a server change so a service user can sign in without a browser (more fork code in the authentication path, to revisit if re-minting becomes painful). Slice C proves on staging that `@actual-app/api` signs in with a minted token as a BASIC user.

### 5. The access path
The assistant reads production only through the hosted connector (the production slice of `mcp-remote`), read-only by default, as its own user. `mcp-remote`'s threat 8 ("the stored credential is a full-access password until a per-budget identity exists") is replaced by this change's identity: a stolen token can act only as the assistant, on its budgets, until disabled. The local `actual-production` entry is removed from Claude Desktop in slice D.

### 6. Development agents
Staging and synthetic data only. A defect that needs production data uses a restored backup on a throwaway staging instance, with Ken approving each time (it is plaintext of real data on an agent-reachable host, so it is Ken's call). The optional server-enforced read-only grant is a separate Backlog story.

### 7. The account split
Agent sessions and Ken's chats share his Anthropic account, so any claude.ai connector (hosted or the Hostinger one in LOCKDOWN) shows up in both. Claude Code documents `ENABLE_CLAUDEAI_MCP_SERVERS=false` (changelog: opts out of making claude.ai MCP servers available); it hides claude.ai connectors in a Claude Code session. It does not remove local Claude Desktop entries, which are separate and are removed in slice D, nor change who owns the account's OAuth grants. So: set the variable for agent sessions, verify by listing a fresh session's tools (slice F), and if anything remains visible, development agents move to a separate Anthropic account or seat, which is the only robust separation. Slice F is Ken-gated because it changes how agents are run on his account.

### 8. Audit
Slice A adds the user id (and OAuth subject, or `local` for stdio) to every audit line and adds a read record for the hosted entry (tool name, status, identity, no data), as `mcp-remote` already requires for access. Slice B adds a fork log line per budget-touching request on the sync server (user id, file id, route, time; never content or token), at the point `requireFileAccess` passes or fails. Both ship daily to somewhere agents cannot rewrite (the Mac mini's pull, 90 days), after LOCKDOWN.

### 9. Order
1. LOCKDOWN (sc-563) done by Ken. Nothing below counts as separation before it, because root reads the host's 0400 files and the sync server's volume (the `actual-production_data` volume holds sessions).
2. Slices A and B can ship before, since they touch no production.
3. Slice C rehearses everything on staging, including the restore.
4. D, E, F are Ken-gated and each ships with a checklist for Ken that says why each step needs him.

## Risks / Trade-offs

- **No server read-only.** Mitigations: the encryption key held only by Ken and the connector, short revocation, the access log.
- **Identity provider outage locks Ken out.** Recovery is the console `reset-password.js` path plus re-enabling password login; the checklist rehearses it on staging.
- **Long-lived token on the host.** Same exposure class as `mcp-remote`'s refresh tokens: 0400 file, revocable, rotated on schedule.
- **ENABLE_CLAUDEAI_MCP_SERVERS is a client-side setting.** It prevents accidents, not a hostile agent; the separate account is the boundary.

## Unverified, settled by slice C on staging (not assumed here)

- The password row is refused with `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true`.
- `@actual-app/api` signs in headless with a minted `sessionToken` as a BASIC user, and the token's lifetime matches `token_expiration`.
- `enabled = 0` ends a session immediately.
- A restore onto an OpenID instance, and of a pre-switch snapshot, behave as Decision 3 says.
- Whether the promote health check signs in.

## Decisions for Ken

- The identity provider and the minted token's lifetime (configuration until then; the lifetime defaults to 30 days).
- Whether to file the optional server-enforced read-only grant.
- The production switch and the account split (slices E and F are his).
