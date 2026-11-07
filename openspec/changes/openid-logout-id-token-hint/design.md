# Design

## Context

See proposal.md for why. Today:

- `loginWithOpenIdFinalize` (`accounts/openid.ts`) gets a `tokenSet` from `client.callback` (or `client.grant`), checks the ID token's `aud`, `azp` and `sub`, then inserts `sessions (token, expires_at, user_id, auth_method)`. The ID token is dropped.
- `POST /logout` (`app-account.js`, sc-2684) reads `auth_method` for the token, deletes the row, then calls `getProviderLogoutUrl()`, which builds the address from discovery's `end_session_endpoint` (`client.endSessionUrl`) or Auth0's `/v2/logout`.
- `getSession` (`account-db.js`) selects `sessions.*`; `validateSession` hands that row to route handlers.
- Session rows are deleted on logout, by `clearExpiredSessions` (on every sign-in), when a user is disabled or deleted (`user-service.ts`), when the auth method changes (`account-db.js`), and when password sessions are reset (`password.js`).

## Goals / Non-Goals

**Goals:** no Auth0 confirmation page on an explicit sign-out; the ID token lives only as long as its session and leaves the server only inside the logout address.

**Non-Goals:** storing access or refresh tokens; validating the hint ourselves (the provider does); a sign-out that works without the token for old sessions (they keep today's page).

## Decisions

### 1. A nullable `id_token` column on `sessions`

A new migration runs `ALTER TABLE sessions ADD COLUMN id_token TEXT`; `down` runs `ALTER TABLE sessions DROP COLUMN id_token` (better-sqlite3 bundles SQLite 3.35 or later). Name the file with the current epoch milliseconds so it sorts after every existing migration.

The column lives on the session row because the token's lifetime is the session's: every path that deletes a session (listed in Context) deletes its token with no new code, and expiry needs no second sweep. Alternatives: a separate `session_id_tokens` table (a second delete on every path above, and orphans if one is missed); the client's cookie or local storage (the brief rules out sending it to the client).

### 2. The callback stores `tokenSet.id_token`, or NULL

The insert becomes `INSERT INTO sessions (token, expires_at, user_id, auth_method, id_token) VALUES (?, ?, ?, ?, ?)` with `tokenSet.id_token ?? null`. It is stored only after the existing `aud`, `azp` and `sub` checks pass, so a token that failed them never reaches the table.

### 3. `/logout` reads the token with the session and passes it in

`POST /logout` selects `auth_method, id_token` for the token, deletes the row, then calls `getProviderLogoutUrl(idToken)`. That function adds the hint only when it has one:

- discovery path: `client.endSessionUrl({ post_logout_redirect_uri, id_token_hint })`;
- Auth0 `/v2/logout` fallback: unchanged (that endpoint does not take a hint);
- no token: the address is exactly today's.

The order stays as sc-2684 set it: the row (and with it the stored token) is gone before the address is built, and any error still yields `data: {}`.

### 4. Nothing else reads the column

`getSession` lists its columns (`token, expires_at, user_id, auth_method`) instead of `sessions.*`, so the token never rides along in `validateSession`'s result into a handler that might echo or log it. `/logout` is the only reader. The server never logs the ID token or the logout address that contains it: the existing `debugSensitive` call in `getProviderLogoutUrl` logs the error only, and that stays true.

### 5. Stored in plain text

The token sits next to the session's bearer token, which is in plain text in the same row and is far more powerful: it opens the user's budgets. Encrypting the ID token with a key on the same host would not protect it from anyone who can read the row. The account database is already covered by the host's disk and backup protection (the encrypted backups); this change adds nothing that needs more.

## Security trade-off

An ID token is not an access token: the sync server never accepts it, and the provider uses it at logout only as a hint naming the session to end. What it does carry is the user's identity claims (`sub`, and the email and name the app requests), signed by the provider, so it is treated as sensitive personal data:

- **At rest:** one per OpenID session, deleted with the session (logout, expiry, user disabled or deleted, auth method changed). A session set to never expire keeps its token as long as it keeps its bearer token; someone who can read that row already holds the stronger secret.
- **In transit:** it leaves the server once, in the `/logout` response to the client that owns the session, and then in the query string of the browser's request to the provider. That puts it in the browser's history and the provider's logs for that one request. This is how OpenID RP-initiated logout is defined, and the token names a session that has already ended on Actual's side.
- **Not exposed elsewhere:** no other route returns it, `getSession` does not select it, and it is never logged.

Accepted: the gain (no extra page on every sign-out) for a short-lived, low-power token in the browser's history once.

## Sessions created before the change

Their `id_token` is NULL after the migration, so `/logout` builds today's address and Auth0 shows its confirmation page once more. They sign out normally. The next sign-in stores a token, so the page goes away by itself. No backfill is possible (the tokens were never kept), and none is needed.

## Risks / Trade-offs

- [Auth0 rejects an expired ID token as a hint] → The OpenID spec asks providers to accept expired hints, but a session can outlive its ID token by hours or days. Staging verification (tasks, group 4) signs out with a session older than the token's `exp`. If Auth0 then shows an error instead of the confirmation page, the fix is a follow-up story (for example, dropping the hint once the token's `exp` has passed), not a reason to hold this change.
- [Auth0 custom domain or a provider without `end_session_endpoint`] → The `/v2/logout` fallback takes no hint and keeps its current behaviour.
- [The logout address is longer] → An ID token is about one kilobyte; the address stays well under browser limits.
- [A fork-only migration] → An upstream migration added later with an earlier timestamp could interact with the runner's ordering. The column name is fork-specific, so it does not collide; check the order when merging upstream migrations.

## Migration Plan

The migration runs on server start. A new server with an old client: the client follows the address it gets, with or without the hint. Rollback: the previous release ignores the extra column, and `down` drops it if needed.
