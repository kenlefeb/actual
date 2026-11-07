# Design

## Context

See proposal.md for why. What the code does today:

- `POST /logout` (`packages/sync-server/src/app-account.js`) takes the session token in the body and deletes that row from `sessions`. It is unauthenticated by design: an unknown token is a no-op.
- `subscribe-sign-out` (`packages/loot-core/src/server/auth/app.ts`) posts to `/logout` with a 5 s timeout, ignores failure ("local sign-out must still work offline"), then unloads encryption keys and removes `user-token`, `encrypt-keys`, `lastBudget` and `readOnly`.
- The `signOut` thunk (`packages/desktop-client/src/users/usersSlice.ts`) is called by the user menu (`LoggedInUser.tsx`, the only "Sign out" item) and also by automatic paths: session expiry in `sync-events.ts`, `App.tsx`, `ConfigServer.tsx` and the admin pages.
- Sign-in (`Login.tsx`): web and the mobile app set `window.location.href` to the provider's authorization URL, so the provider session lives in that browser or WebView. Electron opens it with `window.Actual.openURLInBrowser` and receives the token on a loopback server, so the provider session lives in the system browser.
- `setupOpenIdClient` (`accounts/openid.ts`) discovers the issuer from the stored config (`issuer` holds the discovery URL) and knows `client_id` and `server_hostname`. The `sessions` row records `auth_method`.
- The hosted servers set `ACTUAL_OPENID_DISCOVERY_URL=https://<auth0 domain>/.well-known/openid-configuration` and `ACTUAL_OPENID_SERVER_HOSTNAME=https://<sync fqdn>` from the household template (actual-hosting `production/template/compose.yaml`).

## Goals / Non-Goals

**Goals:** true sign-out on every client with one server change; no per-server code or config beyond what the template already sets.

**Non-Goals:** single logout across servers or back-channel logout; storing the ID token; Auth0 custom domains; changing sign-in.

## Decisions

### 1. The server builds the address; `/logout` returns it

`POST /logout` reads the session row before deleting it. If its `auth_method` is `openid` and OpenID is configured, after the delete it answers `{ status: 'ok', data: { providerLogoutUrl } }`; otherwise `data: {}` as today. The URL is built only after the row is gone, and any error building it (discovery down, bad config) is logged and answered with `data: {}`, never a failure status.

Alternatives: a separate `GET /openid/logout-url` (two round trips and a window where the client holds a URL for a live session); building it in the client (the client does not know the issuer or client id, and would trust its own return URL).

### 2. Discovery first, Auth0 fallback by issuer host

Use `client.endSessionUrl({ post_logout_redirect_uri })` when `issuer.end_session_endpoint` is set; openid-client adds `client_id`. Otherwise, if the issuer URL's parsed hostname equals `auth0.com` or ends in `.auth0.com` (a suffix match at a dot boundary, so `evil-auth0.com` and `auth0.com.evil.example` do not match), build `https://<host>/v2/logout?client_id=…&returnTo=…`. Otherwise return nothing and log a warning. No `id_token_hint`: the server does not keep the ID token, and adding a column for it is not needed to end the session (see Risks).

Checked 2026-11-07: the staging tenant's public discovery document (`https://actual-staging.us.auth0.com/.well-known/openid-configuration`, the issuer in actual-hosting `production/households/ken.json`, `auth0.domain`) has `end_session_endpoint: https://actual-staging.us.auth0.com/oidc/logout`. Staging and production share that tenant, so both use the discovery path; the `/v2/logout` fallback covers other Auth0 tenants.

### 3. Return URL is `new URL('/', server_hostname)`

`server_hostname` is the configured OpenID hostname the callback already uses. The web app at `/` with no token shows the sign-in page, so one URL serves web, phone and the mobile app. Nothing in the request can change it.

### 4. The client follows the URL only on explicit sign-out

`subscribe-sign-out` gains an optional `{ endProviderSession: boolean }` and returns `{ providerLogoutUrl? }`, still clearing the token and keys before returning even if the post fails. Only the user menu passes `true`; the automatic callers keep calling it as today and ignore the URL. After the thunk finishes, the menu handler sends the browser away: Electron through `window.Actual.openURLInBrowser(url)` (the provider session is in the system browser; the app window stays on Actual's sign-in page), everything else through `window.location.assign(url)`. Before either, the client parses the URL and follows it only if its protocol is `https:`, or `http:` with hostname `localhost`, `127.0.0.1` or `[::1]` (development). Anything else (`javascript:`, `file:`, `data:`, an unparseable string) is ignored and the sign-in page shows, so a bad or compromised server cannot run script or open a local file through sign-out.

### 5. Same capability, separate change

See proposal.md, Capabilities. The delta carries a `## Purpose` for `production-identities` so whichever change archives first leaves a real purpose in the main spec.

## Risks / Trade-offs

- [Auth0 may show a "log out?" confirmation without `id_token_hint`] → Accept one extra click; if staging shows it and Ken objects, a follow-up stores the ID token per session.
- [The return URL is not in the app's Allowed Logout URLs] → Auth0 shows an error page; the user is already signed out of Actual (spec: a failed provider logout). Ken adds the URLs before staging verification (tasks, group 5).
- [Electron: the system browser lands on the server's web app] → It shows the sign-in page, since that browser holds no Actual token unless the user also uses the web app there; accepted.
- [Auth0 custom domain] → the host check misses it; discovery's `end_session_endpoint` covers it (the shared tenant exposes it).
- [Ending the provider session signs the user out of other apps on the same tenant (staging and production share it)] → Intended: that is what "sign out" means here.

## Migration Plan

Server and client ship together in one release. An older client against a new server ignores `providerLogoutUrl` (today's behaviour). A new client against an older server gets `data: {}` and signs out locally. Rollback is the previous release; the Allowed Logout URLs can stay.
