# Design

## Context

See proposal.md (Why). Findings: sc-2004 comments 2005 (Security Analyst), 2006 (Architect) and 2007 (PO decision). This change is slice 1: the spec and the design, with no code and no production touch. The slices are filed when it merges. Slice C's staging rehearsal (sc-2042) ran the "to verify" items below; its record is `rehearsal-findings.md`, and the facts, decisions and table in this file are corrected to match it.

Facts the design rests on (read from `packages/sync-server` and `packages/mcp`; the ones marked "to verify" are settled by slice C on staging, not assumed):
- **One active login method.** The `auth` table has one active row; enabling OpenID makes it active. The password row can stay in the table, and `POST /login` accepts a `loginMethod` the client names if `allowedLoginMethods` (env `ACTUAL_ALLOWED_LOGIN_METHODS`, default `password,header,openid`) includes it and the row exists. So switching is not enough: production also sets `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true`, and the rehearsal proved the old password is then refused.
- **Users.** `users.role` is `ADMIN` or `BASIC`; the first OpenID user becomes ADMIN and owner; `enabled = 0` makes `getSession` find no session for that user.
- **Per-budget access.** `files.owner` plus `user_access`. Every sync and file route runs `requireFileAccess`; `/list-user-files` shows a BASIC user only owned and granted budgets. An ADMIN reaches every budget.
- **No read-only grant.** A `user_access` row allows read and write. "Read-only" is client-side: `init({ readOnly: true })` and the hosted entry's lack of write tools. A leaked assistant token with access can write.
- **Session lifetime.** `token_expiration` (env `ACTUAL_TOKEN_EXPIRATION`) defaults to `never`, so OpenID sessions are stored with `expires_at = -1` and do not expire (the 10-minute fallback in `openid.ts` is unreachable). A number is **seconds** for OpenID sessions (minutes for password sessions). The value is read from server configuration at sign-in and stored on the session row (rehearsed in sc-2042). `@actual-app/api` accepts a `sessionToken` in `init`, and the rehearsal signed in headless with one as a BASIC user. `packages/mcp` does not yet: it signs in with a password only (task 8.1).
- **First OpenID sign-in.** With no OpenID user yet, the first sign-in becomes ADMIN and owner. The old password is asked for at that moment only when `ACTUAL_OPENID_ENFORCE` is off; with it on, any identity the provider accepts claims the server (rehearsed). See decision 11.
- **Encryption is a second key.** A user with file access but without the budget's encryption password cannot read an encrypted budget.
- **Audit today.** `appendAudit` lines carry time, tool, call id, ids and changes, no identity; the sync server only uses `console.log`; the `sessions` table records `user_id` and `auth_method` per token.
- **LOCKDOWN today** (actual-hosting `production/LOCKDOWN.md`): agents hold root on the VPS until Ken's step 3; the production password was to be rotated into the Private item "Actual (Production) login" (4a) and the item in "Ken & Agents" deleted (4d); the Mac mini pulls age-encrypted backups with a forced-command key and logs in to nothing.

## Decisions

### 1. Identities
Three kinds, no more, on household `ken`'s server (other households' leads are covered by `household-auth0-apps`). Ken is ADMIN through his own identity at the identity provider, protected by a passkey or second factor and never by an emailed link (agents can read his mail). The assistant is one BASIC user. Development agents have none on production. The identity provider is Auth0 (decision 13); the tenant (shared with staging), applications and callbacks are configuration.

### 2. One rule for the credential
The record is a 1Password item in a new vault, "Ken Assistant", that only Ken's interactive 1Password opens: no service account (its token would sit in a keychain any process running as Ken can ask for), no CLI integration (it stays off, see sc-696), no file on the Mac. Never grant computer-use to 1Password: the vault is protected only by Ken's unlocked desktop app (the rule from the sc-1460 checklist). The only deployed copy is the connector's root-owned 0400 file on the host, drawn from the item by Ken at install time. Rotation replaces both. "Ken & Agents" keeps staging credentials only: the staging promote token, the staging SSH key, staging passwords and age identity. Ken's Private vault keeps his own production admin items ("Actual (Production) login", the backup recovery key).

Why not "no vault, file only": the file is lost with the host; the record lets Ken re-mint after a restore.

### 3. The password users, and what replaces them
Moving production to OpenID retires the shared password for everyone. Each place that uses it:

| Use today | After the switch |
|---|---|
| Ken's browser sign-in (`production/README.md`, Ken's phone and laptop) | Sign in through the identity provider as Ken (ADMIN). |
| `RESTORE.md` restore drill (section 3) | **Keeps the password.** `restore.py` starts the drill container with no environment, so the password row (still in the database after the switch) signs in with `loginMethod: "password"`, and an OpenID sign-in cannot work there (the redirect goes to the stored `server_hostname`, the production address). The production password therefore stays in Ken's Private item as the drill's and the break-glass credential; the drill container must stay loopback-only and be destroyed after. Rehearsed in sc-2042. |
| `RESTORE.md` snapshot restore onto production (section 4) | The release's compose template carries the two login settings (decision 8), so a post-switch snapshot comes back with the password refused and its sessions intact. A **pre-switch** snapshot comes back with the password still accepted (the settings do not remove the only active method), so the restore step must run `enable-openid.js` offline on the volume before `up`, then Ken signs in first (decision 11). Both rehearsed in sc-2042. |
| `LOCKDOWN.md` 4a (change server password in the app, console `reset-password.js`) | These apply to password mode only. After the switch the equivalent is revoking the assistant (disable the user through the admin route, which also deletes its sessions) or re-minting the token; the LOCKDOWN checklist notes the change when slice E lands. `reset-password.js` stays as the recovery path if the identity provider is lost, but re-enabling password login also means removing the two settings from the compose template and restarting (decision 12), so it is a production change Ken approves, not a console-only step. 4d's "change the password again after restoring a pre-4a snapshot" still applies, because the password row stays. |
| The nightly backup, the Mac mini pull, `export-backup.py`, `prune-backups.py`, `pull-backup.py` | Unchanged: they use an SSH forced command and an age key, not a login. |
| Promotes (`promote-production.py`) and the health check (`health.py`) | Unchanged: they sign in to nothing. `health.py` reads `/health`, `/` and `/info`, which answer without a session on an enforcing server (rehearsed; the app-shell check needs a real web build and was not run). |
| Staging scripts (`agent.cjs`, `existing-client-sync.cjs`, `fixture.cjs`, `public-api-smoke.cjs`, `agent-smoke.py`) and the API CI workflow (`.github/workflows/api.yml`, which reads `.state/api-fixture/password`) | Stay on password mode on staging. Staging runs OpenID only for a throwaway rehearsal instance. |
| `snapshot.py`, `export-backup.py`, `restore.py` | Use no login. But every backup holds the live sessions table, so the assistant's token and Ken's sessions are inside every archive and drill copy, and a restore brings back tokens revoked since (decision 8). |
| The stdio and hosted MCP entries (`ACTUAL_PASSWORD`, `ACTUAL_PASSWORD_FILE`) | `packages/mcp` signs in with a password only. Staging keeps that. Production needs the connector to sign in with the minted session token (`sessionToken`), a code change in `packages/mcp` that no slice had: task 8.1. The stdio entry stays refused for production. |

### 4. Headless sign-in: a token Ken mints
Option (a) from the Architect's comment: Ken signs in once through the OpenID flow as the assistant's user to mint a session token, kept in the connector's 0400 file, with `token_expiration` raised for that session to a stated period (the default for this change is 30 days with a calendar reminder in the checklist; the period is configuration). Revocation is `enabled = 0`. Rejected for now: a server change so a service user can sign in without a browser (more fork code in the authentication path, to revisit if re-minting becomes painful). Slice C proves on staging that `@actual-app/api` signs in with a minted token as a BASIC user.

The assistant's BASIC user is a dedicated account at the identity provider (configuration, like the provider itself), not Ken's. It uses a passkey or authenticator-app 2FA, has no recovery through a mailbox agents can read, and its credentials are kept in the "Ken Assistant" vault and the LOCKDOWN inventory.

`token_expiration` is read from server configuration (`config.get('token_expiration')`) when a session is created (`accounts/openid.ts`), so it is server-wide, not per session, and the resulting `expires_at` is stored on the session row. Rehearsed in sc-2042: a token minted under 30 days kept its expiry across restarts after the setting was unset, and a new ADMIN session got the default. The minting procedure therefore sets `ACTUAL_TOKEN_EXPIRATION=2592000` for one restart, mints the assistant's token, and unsets it before Ken signs in as ADMIN. Because the server default is `never` (not 10 minutes, see the facts), this step is what gives the assistant's token an end date at all; Ken's own sessions, left at the default, never expire. The default stays `never` (the Architect's ruling). Whether production should instead set a finite value for everyone stays under "Decisions for Ken". Units: the number is seconds for OpenID sessions and minutes for password sessions.

Revocation: disable the user through the admin route (`PATCH /admin/users`, `enabled: false`), which also deletes the user's sessions. Setting `users.enabled = 0` in SQL only blocks the token while the flag is 0 and a flip back revives it, so the checklist uses the route (or deletes the sessions). A token has write reach to its budgets (rehearsed), so revoking it is the only brake.

### 5. The access path
The assistant reads production only through the hosted connector (the production slice of `mcp-remote`), read-only by default, as its own user. `mcp-remote`'s threat 8 ("the stored credential is a full-access password until a per-budget identity exists") is replaced by this change's identity: a stolen token can act only as the assistant, on its budgets, until disabled. The local `actual-production` entry is removed from Claude Desktop in slice D.

### 6. Development agents
Staging and synthetic data only. A defect that needs production data uses a restored backup on a throwaway staging instance, with Ken approving each time (it is plaintext of real data on an agent-reachable host, so it is Ken's call). The copy is destroyed afterwards, with its own check-off step. The optional server-enforced read-only grant is a separate Backlog story.

### 7. The account split
Agent sessions and Ken's chats share his Anthropic account, so any claude.ai connector (hosted or the Hostinger one in LOCKDOWN) shows up in both. Claude Code documents `ENABLE_CLAUDEAI_MCP_SERVERS=false` (changelog: opts out of making claude.ai MCP servers available); it hides claude.ai connectors in a Claude Code session. It does not remove local Claude Desktop entries, which are separate and are removed in slice D, nor change who owns the account's OAuth grants. The variable is all-or-nothing, though, and it has no effect when set under settings `env`. Agents need the other connectors (Shortcut, Figma), so the repo's `.claude/settings.json` instead denies only the Actual ones with `deniedMcpServers`:
  - `https://*actual-mcp*` matches a hosted connector by URL, not by display name.
  - `https://*.owl-becrux.ts.net/*` matches the tailnet host. It also blocks the hosted staging connector, intentionally: agents reach staging through the stdio `actual-staging*` entries. It covers a production connector whose URL lacks `actual-mcp`.
  - `{serverName: "actual-production"}` matches Ken's local Claude Desktop entry. Names are matched verbatim, with no wildcards; a `serverCommand` match would break if the launcher path or arguments changed.

So: set the deny rule for agent sessions, verify by listing a fresh session's tools (slice F), and if anything remains visible, development agents move to a separate Anthropic account or seat, which is the only robust separation. Slice F is Ken-gated because it changes how agents are run on his account.

### 8. Turning the password off persists
`ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` go in production's root-owned compose template, the file `promote.py` builds every release from. Without them a restored pre-switch snapshot brings the password row back and the old password works again as soon as the server starts. Both variables are added to the LOCKDOWN inventory and to the persistence check, so a template change is caught. Sessions issued by password login stay valid after the settings are on (rehearsed: a password session still carried ADMIN reach), so slice E deletes them (`DELETE FROM sessions WHERE auth_method = 'password'`, or `enable-openid.js`/`/openid/enable`, which delete every session) and verifies none remain. Any token taken while agents had root, or by anyone holding the old password, dies with them.

The settings alone do not refuse the password on a restored **pre-switch** snapshot: that database has only the password method, which stays active. Rehearsed: password login was accepted until `enable-openid.js` was run offline against the restored volume with the provider settings in the environment; after it the password was refused and every session was gone. The restore procedure therefore, before the server is reachable, deletes the sessions table in the restored copy and runs `enable-openid.js` offline on the volume. **This is a step to be scripted, not left as prose** (a story is being filed). Then Ken signs in first (decision 11), then recreates the assistant and re-mints. After any restore, post-switch ones included, delete all sessions and re-mint, because the snapshot's sessions table brings back tokens revoked since.

### 9. Audit
Slice A adds the user id (and OAuth subject, or `local` for stdio) to every audit line and adds a read record for the hosted entry (tool name, status, identity, no data), as `mcp-remote` already requires for access. Slice B (merged, #194) writes one JSON `file-access` line per request that touches a budget file (user id, file id, method, route, time and HTTP status; never content or a token). Access is decided in `requireFileOwner`, which `requireFileAccess` calls, and that is where the line is noted; the status says whether it passed. Both ship daily to somewhere agents cannot rewrite (the Mac mini's pull, 90 days), after LOCKDOWN.

### 10. Order
1. LOCKDOWN (sc-563) done by Ken. Nothing below counts as separation before it, because root reads the host's 0400 files and the sync server's volume (the `actual-production_data` volume holds sessions).
2. Slices A and B can ship before, since they touch no production.
3. Slice C rehearses everything on staging, including the restore.
4. D, E, F are Ken-gated and each ships with a checklist for Ken that says why each step needs him.

### 11. The first sign-in must be Ken's
The first OpenID sign-in on an instance with no OpenID user becomes ADMIN and owner. With `ACTUAL_OPENID_ENFORCE=true` there is no password check at that moment, so any identity the provider accepts can take the server (rehearsed with an unrelated provider user). Two controls, both required: the provider accepts only the two named accounts, and Ken signs in first, before the server is reachable by anyone else or while enforcement is still off so that the old password is asked for. In the shared Auth0 tenant (decision 13) the tenant also holds staging's test users, so the first control is the server's own: `ACTUAL_OPENID_ADMIN_SUBJECT` is Ken's production `sub` and the server creates no user at sign-in, so no other identity can claim it; sign-ups are off and no social or enterprise connection is enabled. This applies to the production switch (slice E) and to every pre-switch restore (decision 8).

A third control closes the window in code (sc-2163, fork patch in `accounts/openid.ts`): `ACTUAL_OPENID_ADMIN_SUBJECT` names Ken's provider `sub`, and while no OpenID user exists the server refuses any other `sub` and creates nothing. It matches `sub`, not the e-mail the server stores as the user name, because an e-mail can change or be reassigned. Production must set it (in the release's `compose.yaml`, with the other OpenID settings; the value is an identifier, not a secret). Unset, the server behaves as upstream and logs a warning.

### 12. Identity provider lost
The provider is Auth0, so this is an Auth0 outage or a lost tenant (which also takes staging with it). It affects new sign-ins to the sync server and to the hosted connector, nothing else: the assistant's minted token and every browser session are local to the sync server. The break-glass password stays loopback-only (decision 8), so the recovery below does not depend on Auth0.

Existing sessions keep working (they are local), new sign-ins fail with `openid-setup-failed`. Recovery, rehearsed: stop the server, `reset-password.js` (needs a terminal), remove the two settings from the compose template and restart, sign in with `loginMethod: "password"` (the password user is an ADMIN and sees every budget), fix the provider, `POST /openid/enable` with the new settings (this deletes every session: Ken signs in again and the assistant is re-minted), restore the two settings. `disable-openid.js` is the full revert and deletes the OpenID users; it was read, not run.

### 13. Identity provider: one shared Auth0 tenant, production's own two users and two applications
Decided by the Architect for sc-2216, following Ken's choice of Auth0 for the hosted connector (sc-1950 comment 2205, sc-1973 comment 2204). Ken decided on 2026-11-04 to reuse the staging tenant for production rather than pay for another. Production adds two users and two applications inside it, beside staging's:

| | Users | Applications |
|---|---|---|
| Shared tenant, production's own | Ken (becomes ADMIN on household `ken`'s sync server) and the assistant (BASIC) | "Actual sync server" (Regular Web Application, callback `<sync server URL>/openid/callback`) and "Actual MCP connector" (callback `<MCP public URL>/oauth/callback`) |

Sign-ups are off and no social or enterprise connection is enabled (staging set both up), and no agent has tenant admin (Ken's own Auth0 team seat is the only admin). Passkey or authenticator MFA for the production users is hardening (sc-2426).

**Separation inside the shared tenant.** Staging test users exist in the same tenant and can reach production's sign-in page, so the controls are at the applications and the servers: each application has its own client id, secret and callbacks; the connector admits one `sub` (the production assistant's); the production sync server admits only users in its own user list (it creates none at sign-in) and, for the first sign-in, only `ACTUAL_OPENID_ADMIN_SUBJECT`, set to Ken's production `sub` on household `ken`'s server. A staging user is therefore refused after Auth0 lets them through. Restricting production's applications to a separate production database connection (so staging users cannot even finish the Auth0 step) is a hardening step in sc-2426, not required to go live.

- **Why not a tenant for the connector only (Ken's earlier wording: "one assistant user").** The sync server's first OpenID sign-in must be Ken's and becomes ADMIN. Ken needs an identity somewhere. Putting it in the same tenant adds one user, not a place to administer.
- **Why two applications, not one.** The sync server and the MCP are different OAuth clients. The sync server is a confidential web client that discovers the issuer and sends the client secret with HTTP Basic (openid-client's default); its user name is the `email` claim (`preferred_username`, `login` and `id` are absent in Auth0, and `email` comes before `sub`). The MCP takes `ACTUAL_MCP_IDP_*` values, `client_secret_post`, and identifies the user by `sub`. Separate applications keep separate secrets, callbacks and revocation: rotating or deleting one does not touch the other.
- **The MCP's allow-list still holds.** `ACTUAL_MCP_ALLOWED_ACCOUNT` is one `sub`. Ken's user can finish an Auth0 sign-in on the connector application, and the MCP then refuses him because his `sub` is not the allowed one (the check is in `packages/mcp/src/oauth.ts`, tested in sc-1972). The assistant's user can sign in to the sync server application, which is intended (it is how its token is minted). Nothing else relies on the tenant holding only one user.
- **Sync-server settings.** `issuer` `https://<tenant-domain>/` (with the trailing slash, as for the MCP), `client_id`, `client_secret`, `server_hostname`; scope is fixed at `openid email profile`. The application's "Token Endpoint Authentication Method" must be Basic, not Auth0's default Post; if login fails with a token-endpoint error, switch to Post.
- **The assistant's Actual user.** The sync server does not create users at sign-in (`userCreationMode` is not `login`), so Ken creates the assistant as an admin with `userName` equal to the assistant's Auth0 email, then patches its role to BASIC and shares the named budgets. The `userName` is the email, not the `sub`; the connector's allowed account is the `sub`. The checklist records both for the assistant.
- **Recovery mail.** Neither user's account recovery may reach a mailbox agents read (spec: "Recovery does not reach agent-readable mail"). Ken's ADMIN identity is as exposed as the assistant's: a password-reset mail an agent can read takes the server. Both users use an address on a mailbox no agent can read and have the reset path off or pointed there; the production Auth0 checklist (sc-2217) holds the steps.
- **Ken's credentials.** His ADMIN password, recovery codes and second factor live only where no agent can read (his Private vault or his own devices), never in "Ken & Agents" or any other agent-readable vault. The tenant admin seat is the single control point for both identities, so it uses a passkey or authenticator, has no agent-readable recovery mailbox, and leaves no machine-to-machine application or Management API token behind.
- **Allowed account.** Configure `ACTUAL_MCP_ALLOWED_ACCOUNT` as the `auth0|…` id, never an email (the connector also accepts a verified email). A lost or recreated tenant gives the assistant a new `sub`: update the connector's allowed account then. Auth0 stores emails lowercased, so create the Actual user lowercased.
- **Sign-ups off in three places.** The database connection's "Disable Sign Ups" (the public signup API stays callable unless it is set), the social connections (a new tenant may ship a Google dev-key connection; disable them), and the connections enabled per application (check both applications). Delete the tenant's Default App. Probe the signup API rather than only reading the user list, and read the user list immediately before enforcement is turned on.
- **The window reopens** after `disable-openid.js`, a pre-switch restore or a recreated tenant, and then both tenant users are candidate claimants. Block the assistant's account in Auth0 until Ken's first sign-in is done and verified.
- **Break-glass is time-boxed.** While recovery runs with password login on, limit the time; the closing step is to re-apply `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` and re-mint the assistant's token.
- **Cost.** One shared tenant: production adds two users and two applications to a tenant Ken already pays for. Whether his plan includes MFA and passkeys is unchecked and belongs to sc-2426.

Options weighed, and why they lost:
- **(b) a separate tenant for the sync server.** Better only in that the connector tenant stays "one user". It doubles the tenants, secrets and admin places for no change in what an agent can reach (no agent has admin in either), and the `sub` allow-list already makes the shared tenant safe. Rejected.
- **(c) a different provider for the sync server (Google or another).** Two providers, two sets of recovery and 2FA to keep agent-safe, and a personal Google account in the loop. Rejected.
- **One application for both.** The two clients need different callbacks, authentication methods and revocation; a shared secret would tie the connector's rotation to the sync server's. Rejected.

Auth0 behaviour checked during the real setup, not in a rehearsal (sc-2274 cancelled): discovery, the Basic or Post setting, `email` as the stored user name, refusal of an unlisted user, and that no sign-up path exists.

## Risks / Trade-offs

- **No server read-only.** Mitigations: the encryption key held only by Ken and the connector, short revocation, the access log.
- **Auth0 outage or a lost tenant locks Ken out of new sign-ins.** Recovery is decision 12, rehearsed in sc-2042; it needs a template change, so it is a production change.
- **Whoever can start a container without the two settings has password login.** The drill container does, by design; the password row stays for as long as the database does.
- **A BASIC user can read the user list** (`GET /admin/users` has no admin check). It holds two e-mail addresses; accepted.
- **Long-lived token on the host.** Same exposure class as `mcp-remote`'s refresh tokens: 0400 file, revocable, rotated on schedule.
- **The `deniedMcpServers` rule is a client-side setting.** It prevents accidents, not a hostile agent; the separate account is the boundary.
- **Renaming the Desktop `actual-production` entry silently breaks the name rule.** Re-check the rule whenever that entry changes.
- **Tested only on Claude Code 2.1.316, from CLI sessions.** Desktop-app and cloud sessions are unverified (task 7.2).
- **Anyone with repo write access can edit `.claude/settings.json`** and so remove the rule.

## Settled by slice C (sc-2042; details in `rehearsal-findings.md`)

- The password is refused with `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` once OpenID is active; with the default settings it is **not** refused (`loginMethod: "password"` signs in). Proven.
- `@actual-app/api` signs in headless with a minted `sessionToken` as a BASIC user; the token's lifetime is `expires_at` as set by `token_expiration` at minting, `never` by default. Proven. `packages/mcp` cannot use it yet (task 8.1).
- Disabling the user through the admin route ends the token at once and deletes its sessions. Proven (raw SQL `enabled = 0` is reversible).
- `token_expiration` is server-wide and stored per session row; set-mint-unset leaves a new ADMIN session at the default. Proven. The default is `never`, not 10 minutes.
- Deleting the password sessions ends a password-issued token. Proven.
- A post-switch restore keeps the password refused and the sessions intact; a pre-switch restore keeps the password **accepted** until the switch is re-applied offline. The drill signs in with the password row. Proven.
- The promote health check signs in to nothing. Proven by reading `health.py` and answering its URLs without a token.
- Not proven: the web UI, Auth0 (decision 13; checked during the real setup), `reset-password.js` on a running server (see the findings note). The rehearsal used Dex as a stand-in, so Auth0 is checked on the real tenant and fixed forward (Ken, 2026-11-04); hardening is sc-2426.

## Decisions for Ken

- The minted token's lifetime (configuration; it defaults to 30 days). The identity provider is decided: Auth0 (decision 13).
- Whether to file the optional server-enforced read-only grant.
- Whether production sets a finite `ACTUAL_TOKEN_EXPIRATION` for everyone (decision 4; the default stays `never`; seconds for OpenID sessions, minutes for password sessions), and that sign-ups stay off in the shared tenant, since open sign-ups reopen the claim window (decision 11).
- The production switch and the account split (slices E and F are his).
