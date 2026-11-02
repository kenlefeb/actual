# Rehearsal findings: OpenID on a throwaway instance (sc-2042, slice C)

Run 2026-11-02 for tasks 4.1 to 4.4. Where a result contradicts `design.md` or the spec, this note says so and the design and spec are corrected in the same PR.

## What was run

- **Server:** the fork's `packages/sync-server` built from `development` at 900d5d832 (reports 26.10.1-alpha.21), run with Node 24.22.1 in a local Docker container with its own data volume, port and network. The code path under test (account, OpenID, admin and sync routes) is the code production runs. Real staging and production were not touched.
- **Client:** `@actual-app/api` from the alpha.19 image's `dist` (the newest built copy at hand; `sessionToken` support is in it). The server is alpha.21; only the client is one version older.
- **Identity provider:** Dex v2.41.1 with three static users (an ADMIN, a BASIC and an unrelated one), standing in for Google. Behaviour under test is Actual's. The real Google OAuth client is still a step for Ken (sc-1972, sc-2004 slice E), and nothing here used a Google console or account. Dex returned `email` and no `preferred_username`, so Actual named users by e-mail address; Google does the same.
- **Sign-in:** the OpenID code flow was driven without a browser by a script that follows the redirects and posts the Dex login form.
- **Restore tooling:** the real `actual-hosting` `scripts/restore.py`, with only the container name and host port changed so it could not touch the real `actual-staging-restore-check` container. It was run against backup directories built like `snapshot.py` builds them (a `data/` copy, plus a `manifest.json` with hashes and the image id).
- **Not covered:** the web UI (this build has no web client, so the Settings pages, the login page's method chooser and `health.py`'s app-shell check were not exercised), Tailscale and HTTPS, the non-root container user, and `disable-openid.js` (read, not run). Anything below that depends on those is marked.

Everything created for the rehearsal (containers, the Dex instance, the data volume, generated passwords and tokens, backup copies) was deleted afterwards.

## Results by task

### 4.1 Refusal and visibility: proven

| Check | Result |
|---|---|
| OpenID on, but only the default login settings | The old password is **not** refused: `POST /account/login` with `{loginMethod:"password", password}` returned a session that listed both budgets and the user list (the password user is an ADMIN). Bare `{password}` hit the OpenID branch and failed. |
| `ACTUAL_ALLOWED_LOGIN_METHODS=openid` and `ACTUAL_OPENID_ENFORCE=true` | Every form was refused and issued no session: `{password}`, `{loginMethod:"password"}`, `{loginMethod:"header"}` plus `x-actual-password`. `login-methods` and `needs-bootstrap` list only OpenID. This confirms the design's point that switching alone is not enough. |
| BASIC user's budget list | Empty before sharing; after sharing one budget, exactly that one. The admin's second budget stayed invisible. |
| BASIC user against the unshared budget | `get-user-file-info` and `download-user-file` returned 403 `file-access-not-allowed`; `@actual-app/api` `downloadBudget` of its sync id failed with "not found". |
| BASIC user against admin routes | `POST /admin/users` and `POST /openid/disable` returned 403. **`GET /admin/users` returned 200** (the list of users): a BASIC user can read the user list. Only writes are admin-only. |

### 4.2 Headless sign-in, lifetime, revocation: proven, with design corrections

- `@actual-app/api` `init({serverURL, sessionToken})` as the BASIC user listed only the shared budget, downloaded and read it, and was refused the unshared one. The same call as ADMIN saw both (control).
- **A BASIC token with access can write.** An `importTransactions` plus `sync` through the minted token succeeded. This confirms "no read-only grant".
- **The default lifetime is "never", not 10 minutes.** With no `ACTUAL_TOKEN_EXPIRATION`, new OpenID sessions are stored with `expires_at = -1`. The server's config default is `never`, so the code's 10-minute fallback in `openid.ts` is unreachable. Design fact "an OpenID session lasts 10 minutes" was wrong; Ken's own browser sessions also never expire today.
- **Units differ by login method.** For OpenID sessions a numeric `token_expiration` is **seconds** (60 gave `expires_in=60s`); for password sessions the code multiplies by 60, so the same number is **minutes**.
- **`token_expiration` is server-wide and read at sign-in; the value is stored on each session row.** Sequence run: 60 s set, an ADMIN and a BASIC session minted (both 60 s); set to 2,592,000 (30 days), a BASIC token minted (30 days); unset again, a new ADMIN session got `-1` (the default) and the 30-day token kept `expires_in` of about 30 days across both restarts and still worked headless. So the raise-mint-restore procedure works and does leave new ADMIN sessions at the default. Because the default is `never`, the "raise" is really "set a finite period for the minting", and the finite period is the only thing that makes the assistant's token expire.
- **Expiry is enforced:** with a 5 s setting, a token worked, then returned 401 `token-expired` after 7 s, and `api.init` failed with "invalid or expired session token".
- **Disabling ends the token at once.** Through the admin route (`PATCH /admin/users` with `enabled:false`) the token was refused on the next request, and the route also **deletes the user's sessions**, so re-enabling does not bring the token back (the user must sign in again). Setting `users.enabled = 0` directly in SQL is different: it blocks the token only while the flag is 0, and flipping it back revives the same token. Revoke through the admin route or delete the sessions.
- **Password sessions survive the switch to openid-only settings.** A password session taken while openid was active was still accepted by the server restarted with the two settings, and carried ADMIN reach. Deleting `sessions WHERE auth_method = 'password'` ended it. (`/openid/enable`, `enable-openid.js` and `reset-password.js` also delete password sessions: the first two delete every session.)

### 4.3 Restore drill and snapshot restore: proven, with design corrections

Post-switch snapshot (OpenID active, sessions present):

- `restore.py` verified the hashes and started it. **`restore.py` passes no environment**, so the drill container accepts `{loginMethod:"password", password}`: the drill signs in with the password row, which is still in the database after the switch. Browser sign-in through OpenID is impossible in a drill: the redirect URI is the `server_hostname` stored in the database (the production address), and a `returnUrl` of `127.0.0.1` is rejected as invalid (only the server's own hostname and `localhost` pass). So the production password is **not retired** by the switch: the drill keeps needing it (or a session row inserted into the restored copy).
- The snapshot contains every live session. The assistant's token and an ADMIN token worked against the drill copy. A restored snapshot also **resurrects tokens revoked after it was taken**: a 30-day token that the live server had since revoked (by `/openid/enable`) was refused live and accepted by the restored copy.
- Restored with the two settings (as the VPS restore would run from the compose template): the password was refused; the assistant and ADMIN sessions kept working.

Pre-switch snapshot (password only):

- Restored with `restore.py` (no settings): the password signs in, as `RESTORE.md` says today.
- **Restored with the two settings in the template, the password is still accepted.** The pre-switch database has no `openid` row; `ACTUAL_ALLOWED_LOGIN_METHODS=openid` does not remove the only active method. The spec scenario "A restored password row stays refused" does not hold for a pre-switch snapshot. The password is refused only after the switch is re-applied.
- Re-applying the switch offline worked: with the provider settings in the environment (`ACTUAL_OPENID_DISCOVERY_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_SERVER_HOSTNAME`), `node build/scripts/enable-openid.js` against the restored data (server stopped) added the openid row, made it active and **deleted all sessions**. A password session that had been issued from the restored data was refused afterwards, and password login was refused. The users created after the snapshot (the assistant) do not exist and its token is gone: create and mint again.
- **First sign-in after a pre-switch restore:** see the finding below.

### 4.4 Identity provider lost: proven

1. Dex stopped. A new OpenID sign-in failed with `openid-setup-failed`. Sessions already issued (Ken's and the assistant's) kept working, because they are checked against the local database.
2. With the server stopped, `node build/scripts/reset-password.js` set a new password (it needs a terminal for its masked prompt; driven here with a pseudo-terminal). With the two settings still on, the new password was **still refused**.
3. Re-enabling password login means removing `ACTUAL_ALLOWED_LOGIN_METHODS` and `ACTUAL_OPENID_ENFORCE` and restarting. It is a compose change, not a console-only step. Then `{loginMethod:"password", password}` returned a session for the password user (ADMIN), which saw every budget. Bare `{password}` still takes the OpenID branch; the web UI's login page offers the Password choice only when the method list shows it, which it does once enforcement is off (UI not exercised).
4. Repair: with the provider reachable again, `POST /openid/enable` with the new provider settings returned ok and **deleted every session** (Ken's browsers and the assistant's token): sign in again and re-mint. Putting the two settings back refused the password again and OpenID sign-in worked.
5. Not run: `disable-openid.js`. From the code it needs the password, deletes every OpenID user and their access, and leaves the budgets with the password user; it is the full revert, not a recovery.

## Findings that change the design

1. **The first OpenID sign-in claims ownership when enforcement is on.** On an instance with no OpenID user yet (a fresh switch, or a pre-switch snapshot with the switch re-applied), the first sign-in becomes ADMIN and owner. Without enforcement the server asks for the old password at that first sign-in; **with `ACTUAL_OPENID_ENFORCE=true` it does not** (the password method is hidden from the list the check consults). An unrelated identity from the provider (Dex's third user) signed in with no password and became ADMIN and owner. Anything the provider accepts can claim the server. Auth0 accepts only the tenant's own users, so keeping the tenant to two users with sign-ups off closes it (design decision 11). Fix in the plan: restrict the provider client to the two named accounts, and make Ken's first sign-in happen before enforcement is on or before the server is reachable (spec requirement added).
2. **The MCP server cannot use a session token yet.** `packages/mcp` signs in with `api.init({password})` only (`connection.ts`; `ACTUAL_PASSWORD` and `ACTUAL_PASSWORD_FILE`). The design's "minted token in the connector's 0400 file" needs a code change in `packages/mcp` for both the stdio and hosted entries. This is not in slices A to F; it is added as task 8.1.
3. **Token lifetime defaults to never** (see 4.2). Decision 4's "raise" wording and the "10-minute default" fact are corrected. Ken's own sessions are also unlimited unless production sets a finite `ACTUAL_TOKEN_EXPIRATION`; that is a decision for Ken and the Architect, recorded in the design.
4. **The production password stays** as the drill's sign-in and the break-glass recovery credential. Decision 3's row for the drill is corrected, and the password row is a backdoor for as long as any process runs without the template's two settings (the drill container, a hand-started container).
5. **A restore resurrects revoked tokens.** After any restore, delete all sessions (re-run `/openid/enable`, or `enable-openid.js` offline, which does) and re-mint.
6. **A pre-switch restore needs the switch re-applied before the server is reachable** (finding 1's window, and the password still works until then). Run `enable-openid.js` offline on the volume before `up`.

Smaller facts, no design change:

- `POST /admin/users` validates `role` but does not store it: users it creates have a NULL role. A NULL role is not ADMIN, so the user behaves as BASIC; `PATCH /admin/users` with `role: "BASIC"` stores it. Slice E's checklist creates the assistant and then patches the role.
- After the switch, the budgets stay owned by the hidden password user (`user_name = ''`). The first OpenID ADMIN is not made their owner (the transfer in `openid.ts` is skipped because `getUserByUsername('')` returns null). The ADMIN reaches them anyway. The hidden user is an enabled ADMIN that only a password session can use. `GET /admin/users` does not list it.
- `health.py` and the promote health check sign in to nothing: they read `/health`, `/` and `/info`, which answered without a token on an enforcing server.
- The fork's file-access log (sc-2033) wrote a line per budget route during the rehearsal.

## Not proven

- Web UI behaviour (Settings, the login page's method choice, `health.py`'s app-shell check against a real build).
- Auth0 as the provider (the decided provider, design decision 13), including how it shapes `email`, `sub` and the user name that Actual stores, and its token-endpoint authentication setting. Dex gave the e-mail address. Task 9.1 (sc-2274) covers it.
- `reset-password.js` against a running container (the rehearsal stopped the server first).
- The VPS-only parts of `RESTORE.md` section 4 (the Docker volume replace, the tailnet sidecar), and the non-root container user.
- Re-running the rehearsal against the real `local/actual-staging` image: the code under test is the same source, but it is not that image.
