# Tasks

Each group ends with the story that ships it. Until the slice stories are filed, every group names sc-2004; task 1.4 replaces each with its own id and adds the ids to `x-shortcut`.

## 1. Spec and design (sc-2004)

- [ ] 1.1 Spec `production-identities` and the design; verify with `openspec validate production-identities --strict`.
- [ ] 1.2 Security Analyst approves before any code, and the PO approves.
- [ ] 1.3 Add `production-identities` to the #1550 row of the epic table in `docs/agents/issue-tracker.md` (done in this PR) and, when the change merges, to the epic description, and create the `spec:production-identities` label.
- [ ] 1.4 File the slice stories under epic 1550 (A to F below), give each of groups 2 to 7 its story id, add them to `x-shortcut`, and add the label to each.

## 2. Slice A: MCP audit identity (sc-2024)

- [x] 2.1 Add the acting identity (sync-server user id, OAuth subject or `local`) to every audit line and to the hosted entry's read record, with tests named after "An audit line names its identity". Edit the `mcp-server` "Write audit log" requirement in this slice. No production touch.

## 3. Slice B: sync-server access log (sc-2033)

- [x] 3.1 Add the fork log line (user id, file id, route, time; never content or a token) where file access is decided, with tests named after "The access log holds no content". Fork-only server work.
- [x] 3.2 Document the daily off-host copy (Mac mini pull, 90 days) as a runbook for slice D.

## 4. Slice C: staging rehearsal of OpenID (sc-2042)

The staging half of sc-1555. Run on a throwaway local instance with Dex standing in for the identity provider; the record is `rehearsal-findings.md`. The provider is Auth0 (design decision 13); the Auth0 specifics are group 9.

- [x] 4.1 On a throwaway staging instance: OpenID on, `ACTUAL_ALLOWED_LOGIN_METHODS=openid`, `ACTUAL_OPENID_ENFORCE=true`; an ADMIN and a BASIC user; one budget shared. Record that the old password is refused ("The shared password no longer works") and that the BASIC user sees only the shared budget ("An unshared budget is invisible"). Not proven by the rehearsal: the web UI, real Google, and `reset-password.js` against a running server (see `rehearsal-findings.md`).
- [x] 4.2 Prove headless sign-in with `@actual-app/api` `sessionToken` as the BASIC user, the token's lifetime, whether `token_expiration` is server-wide (if so, setting it for one restart to mint leaves a new ADMIN session at the default: "Minting does not change Ken's sessions"), and that `enabled = 0` ends it ("Staging proves the sign-in first", "Disabling the user ends the token"). Not proven by the rehearsal: the web UI, real Google, and `reset-password.js` against a running server (see `rehearsal-findings.md`).
- [x] 4.3 Rehearse the restore drill and a snapshot restore (post-switch and pre-switch) onto an OpenID instance (the pre-switch restore needs the offline `enable-openid.js` step, which also deletes the restored sessions table; to be scripted, not prose), and list every other use of the production password found (promote health check included) in the design's table ("A restore under OpenID", "A pre-switch snapshot is restored"). Not proven by the rehearsal: the web UI, real Google, and `reset-password.js` against a running server (see `rehearsal-findings.md`).
- [x] 4.4 Rehearse the identity-provider-lost recovery (console `reset-password.js`, re-enable password login). Not proven by the rehearsal: the web UI, real Google, and `reset-password.js` against a running server (see `rehearsal-findings.md`).

## 5. Slice D: vault separation and the Desktop entry, Ken's gate (sc-2004)

Needs LOCKDOWN (sc-563) done first.

- [ ] 5.1 Write the checklist for Ken (each step says why it needs Ken; no Checklist Reviewer round): create the "Ken Assistant" vault; confirm "Ken & Agents" holds staging only; remove the local `actual-production` Claude Desktop entry and any production launcher ("One rule for where the credential lives", "No local production entry"). The token-location inventory moves to the pre-release hardening phase (sc-2426).
- [ ] 5.2 Moved to the pre-release hardening phase (sc-2426): the `LOCKDOWN.md` inventory rows for the vault, the 0400 file, the token and the Auth0 tenant. The Private item "Actual (Production) login" stays as the break-glass credential.
- [ ] 5.3 Put "never grant computer-use to 1Password" in the checklist. The break-glass copy's destruction step moves to sc-2426.

## 6. Slice E: the production switch, Ken's gate (sc-2004)

- [ ] 6.1 Write the checklist for Ken, in this order, each step saying why it needs him; do it on production directly and fix forward, no rehearsal or Checklist Reviewer round: (1) back up; (2) sign in as Ken with the password (ADMIN); (3) set `ACTUAL_OPENID_ADMIN_SUBJECT` to Ken's Auth0 `sub` and enable OpenID with enforcement still off (`ACTUAL_OPENID_ENFORCE` unset); (4) Ken signs in first through the Auth0 application "Actual sync server", and the server asks for the old password; (5) check there is exactly one OpenID user, Ken's, as ADMIN; (6) set `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` in the root-owned compose template and verify the password is refused ("The shared password no longer works"); (7) delete the sessions with `auth_method = 'password'` ("A password session from before the switch is refused"); (8) create the assistant as an admin with `userName` set to its Auth0 email (the sync server stores the `email` claim as the user name), patch its role to BASIC, share only the named budgets, and record its `sub` for the connector's `ACTUAL_MCP_ALLOWED_ACCOUNT`; (9) set `ACTUAL_TOKEN_EXPIRATION` for one restart, mint the token into the connector's 0400 file, then unset it before signing in as ADMIN again; then the production slice of `mcp-remote` may start ("Production signs in only through OpenID", "The assistant is not an administrator", "An unrelated identity cannot claim the server"). State in the checklist that sign-ups stay off, and that the first-sign-in claim window is closed by `ACTUAL_OPENID_ADMIN_SUBJECT` (Ken's production `sub`) together with the server creating no user at sign-in (the shared tenant also holds staging's users, so the user count is not the control), and that the "Actual sync server" application's token endpoint authentication method is Basic to start; if login fails with a token-endpoint error, switch to Post and note it. The sync server's settings are the issuer `https://<tenant-domain>/`, the application's client id and secret and the server hostname; the secret goes in the root-owned compose template's secret mount, not the repository. The checklist also states: the connector's allowed account is the `auth0|…` id, never an email; sign-ups are off on the database connection and the social connections are disabled; Ken's ADMIN credentials are never stored in "Ken & Agents" or another agent-readable vault; Actual users are created lowercased; a recreated tenant means a new `sub` and an updated allowed account. Auth0 being down is the "identity provider lost" recovery (design decision 12), which does not need Auth0. Revoke the assistant through the admin route. Everything cut from this list (MFA, recovery mail, Default App, signup probes, restore drill, LOCKDOWN rows, docs) is in sc-2426. The connector needs slice G (sc-2136) first.

## 7. Slice F: the account split, Ken's gate (sc-2004)

- [x] 7.1 CLI sessions verified: `deniedMcpServers` in the committed `.claude/settings.json` denies the hosted Actual connectors by URL and the local `actual-production` entry by name. A fresh `claude -p` (2.1.316) lists 0 Actual connector tools while Shortcut and the other claude.ai connectors stay connected (28 of 29 remain). `ENABLE_CLAUDEAI_MCP_SERVERS` is ignored under settings `env`, and `disableClaudeAiConnectors` also removes Shortcut and the rest, so neither is used. If any connector or production entry still shows, write the checklist to move development agents to a separate Anthropic account or seat, with what each step needs from Ken.
- [ ] 7.2 Verify from a fresh desktop-app Code session, and from a cloud session if one is available, that no Actual connector or `actual-production` tools are listed; record the result on sc-2069.

## 8. Slice G: the MCP server signs in with a session token (sc-2136)

Found by the slice C rehearsal: `packages/mcp` (stdio and hosted entries) can only sign in with `ACTUAL_PASSWORD` or `ACTUAL_PASSWORD_FILE`.

- [x] 8.1 Let both MCP entries read a session token from `ACTUAL_SESSION_TOKEN_FILE` (0400, never an environment value) and pass it to `api.init({ sessionToken })`, refusing a password and a token together; edit the `mcp-server` credentials requirement and the `mcp-remote` credential requirement in this slice; add the `packages/mcp/coverage.json` line if a handler changes. Tests first.

## 9. Server backstop: the first sign-in must be the configured admin (sc-2163)

- [x] 9.1 Add `ACTUAL_OPENID_ADMIN_SUBJECT` and refuse a first OpenID sign-in whose `sub` differs, creating no user; unset keeps upstream behaviour and warns ("A first sign-in from another identity is refused", "Ken's first sign-in still works").
- [ ] 9.2 Slice E's checklist (6.1) records Ken's Auth0 `sub` and sets `ACTUAL_OPENID_ADMIN_SUBJECT` to it in the release's `compose.yaml` before OpenID is enabled. The LOCKDOWN inventory and persistence-check rows move to sc-2426.
