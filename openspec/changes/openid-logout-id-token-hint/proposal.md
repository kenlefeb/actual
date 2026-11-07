# Proposal

## Why

Shortcut sc-2970, found while verifying sc-2684 on production (alpha.28): "Sign out" works but Auth0 first shows its own "Are you sure you want to log out?" page. The server sends the browser to the provider's `/oidc/logout` with only `client_id` and `post_logout_redirect_uri` (`getProviderLogoutUrl` in `packages/sync-server/src/accounts/openid.ts`). Without an `id_token_hint`, Auth0 cannot tell which session is ending and asks the user to confirm.

## What Changes

- The OpenID callback keeps the ID token it receives with the new session row on the server.
- `POST /logout` reads that ID token together with the session, deletes the row, and adds it as `id_token_hint` to the provider logout address. Auth0 then ends the session without the confirmation page.
- The ID token never reaches the client except inside that one logout address. It is never logged and never returned by any other route.
- Sessions created before this change have no stored ID token. They still sign out, with the confirmation page as today.

Out of scope: other OpenID changes (sign-in, `prompt`, back-channel logout, refresh tokens), password sessions, and the hosted MCP connector's sign-out.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `production-identities`: adds one requirement, that sign-out skips the provider's confirmation page when the session has an ID token. The sign-out requirements it builds on come from the active change `openid-true-sign-out` (sc-2684), which is not archived yet, so this change adds a requirement rather than modifying one. As with that change, a separate change keeps one story per change and lets each archive on its own; both use the same capability path. This change supersedes `openid-true-sign-out` design decision 2's "No `id_token_hint`" and its matching risk, which named this follow-up.

## Mobile scope

No mobile screen changes. The phone UI signs out from the user menu on the budget list, and the mobile app (Capacitor) runs the same web build in a WebView. Both follow the address the server returns, so the server change covers them. The phone path keeps its own scenario and its own end-to-end assertion (`e2e/sign-out.mobile.test.ts`).

## Impact

- `packages/sync-server/migrations/`: new migration adding `sessions.id_token`.
- `packages/sync-server/src/accounts/openid.ts`: the callback stores the ID token; `getProviderLogoutUrl` takes it as an argument.
- `packages/sync-server/src/app-account.js` (`POST /logout`) and `src/account-db.js` (`getSession` stops selecting `sessions.*`).
- The e2e OpenID stub (`packages/desktop-client/e2e/fixtures/openid-provider.ts`) and the sign-out e2e tests.
- No client, Auth0 tenant or hosting change. The return URLs registered for sc-2684 still apply.
