# Tasks

Each group ends with the story that ships it. Until the slice stories are filed, every group names sc-2004; task 1.4 replaces each with its own id and adds the ids to `x-shortcut`.

## 1. Spec and design (sc-2004)

- [ ] 1.1 Spec `production-identities` and the design; verify with `openspec validate production-identities --strict`.
- [ ] 1.2 Security Analyst approves before any code, and the PO approves.
- [ ] 1.3 Add `production-identities` to the #1550 row of the epic table in `docs/agents/issue-tracker.md` (done in this PR) and, when the change merges, to the epic description, and create the `spec:production-identities` label.
- [ ] 1.4 File the slice stories under epic 1550 (A to F below), give each of groups 2 to 7 its story id, add them to `x-shortcut`, and add the label to each.

## 2. Slice A: MCP audit identity (sc-2024)

- [x] 2.1 Add the acting identity (sync-server user id, OAuth subject or `local`) to every audit line and to the hosted entry's read record, with tests named after "An audit line names its identity". Edit the `mcp-server` "Write audit log" requirement in this slice. No production touch.

## 3. Slice B: sync-server access log (sc-2004)

- [ ] 3.1 Add the fork log line (user id, file id, route, time; never content or a token) where `requireFileAccess` decides, with tests named after "The access log holds no content". Fork-only server work.
- [ ] 3.2 Document the daily off-host copy (Mac mini pull, 90 days) as a runbook for slice D.

## 4. Slice C: staging rehearsal of OpenID (sc-2004)

Needs Ken's identity-provider choice. The staging half of sc-1555.

- [ ] 4.1 On a throwaway staging instance: OpenID on, `ACTUAL_ALLOWED_LOGIN_METHODS=openid`, `ACTUAL_OPENID_ENFORCE=true`; an ADMIN and a BASIC user; one budget shared. Record that the old password is refused ("The shared password no longer works") and that the BASIC user sees only the shared budget ("An unshared budget is invisible").
- [ ] 4.2 Prove headless sign-in with `@actual-app/api` `sessionToken` as the BASIC user, the token's lifetime, whether `token_expiration` is server-wide (if so, the raise-mint-restore procedure leaves a new ADMIN session at the default: "Minting does not lengthen Ken's sessions"), and that `enabled = 0` ends it ("Staging proves the sign-in first", "Disabling the user ends the token").
- [ ] 4.3 Rehearse the restore drill and a snapshot restore (post-switch and pre-switch) onto an OpenID instance, and list every other use of the production password found (promote health check included) in the design's table ("A restore under OpenID", "A pre-switch snapshot is restored").
- [ ] 4.4 Rehearse the identity-provider-lost recovery (console `reset-password.js`, re-enable password login).

## 5. Slice D: vault separation and the Desktop entry, Ken's gate (sc-2004)

Needs LOCKDOWN (sc-563) done first.

- [ ] 5.1 Write the checklist for Ken (reviewed by the Checklist Reviewer; each step says why it needs Ken): create the "Ken Assistant" vault; confirm "Ken & Agents" holds staging only; remove the local `actual-production` Claude Desktop entry and any production launcher; inventory where the assistant's token exists ("One rule for where the credential lives", "No local production entry").
- [ ] 5.2 Add the vault, the 0400 file, the token and the assistant's identity-provider account (passkey or 2FA, no agent-readable recovery: "Recovery does not reach agent-readable mail") to `LOCKDOWN.md`'s inventory rows in the same PR.
- [ ] 5.3 Put "never grant computer-use to 1Password" in the checklist, and add the break-glass copy's destruction as its own check-off step ("The break-glass copy is destroyed").

## 6. Slice E: the production switch, Ken's gate (sc-2004)

- [ ] 6.1 Write the checklist for Ken: confirm LOCKDOWN is done; back up and verify a restore; sign in as Ken (ADMIN); enable OpenID with the two login settings; create the assistant (BASIC), share only the named budgets; mint the token into the connector's 0400 file; disable password login and verify it is refused; set `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` in the root-owned compose template (not as one-off settings) and add both to the LOCKDOWN inventory and persistence check ("A template change is caught"); delete the sessions with `auth_method = 'password'` and verify none remain ("A password session from before the switch is refused"); raise `token_expiration` only for the minting and restore it before signing in as ADMIN; update `README.md`, `RESTORE.md` and `LOCKDOWN.md` for OpenID; then the production slice of `mcp-remote` may start ("LOCKDOWN comes first", "Production signs in only through OpenID", "The assistant is not an administrator").

## 7. Slice F: the account split, Ken's gate (sc-2004)

- [ ] 7.1 Set `ENABLE_CLAUDEAI_MCP_SERVERS=false` for agent sessions and list a fresh session's tools ("A fresh agent session lists no production tools"). If any connector or production entry still shows, write the checklist to move development agents to a separate Anthropic account or seat, with what each step needs from Ken.
