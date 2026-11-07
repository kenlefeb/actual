# Proposal

## Why

Shortcut sc-2684 (Ken, not urgent): after "Sign out", pressing "Sign in with OpenID" asks Auth0 only for the previous account's MFA, never for a username. Sign-out ends Actual's session (`POST /logout`, `subscribe-sign-out`) but never the identity provider's session, and the authorization request sends no `prompt`, so Auth0 silently reuses the remembered user. Ken cannot switch accounts (admin vs. assistant), and with one Auth0 tenant serving every household (ADR 0009, sc-2719) one browser session would carry a user from one household's sign-in to another's.

The Product Owner chose true sign-out (comment on sc-2684, 2026-11-07): end Actual's session first, then send the browser to the provider's logout and back to Actual's sign-in page. `prompt=login` alone was rejected because it leaves the provider session open.

## What Changes

- An explicit "Sign out" on a session that came from OpenID ends Actual's session on the server first, then sends the browser to the provider's logout: the discovery document's `end_session_endpoint`, or Auth0's `/v2/logout` when discovery has none.
- The provider returns the browser to the server's own base URL, derived from the server's configured OpenID hostname, so every server (staging, production, each household) returns to its own address without per-server code.
- A failing or unreachable provider logout never leaves the user signed in to Actual: Actual's session is gone before the provider is contacted.
- Automatic sign-outs (expired session, server change, lost access) and password sessions keep today's behaviour: Actual's session only.

Out of scope: which accounts may sign in (sc-2163 backstop), password login, `prompt=login`/`select_account` on sign-in, and sign-out from the hosted MCP connector.

## Capabilities

### New Capabilities

None. See the next section for why this does not add a capability.

### Modified Capabilities

- `production-identities`: adds sign-out requirements. The capability is not in `openspec/specs/` yet; it is introduced by the active change `openspec/changes/production-identities` (sc-2004 and others). This change adds its requirements to that same capability as a separate change rather than a delta inside that change, because:
  - that change's remaining slices are Ken-gated behind LOCKDOWN (sc-563) and will not archive soon, while sign-out is a small fix that should archive as soon as its story merges;
  - one change per story keeps the PR, the `x-shortcut` link and the archive step simple;
  - both changes use the same capability path, so no second capability appears. Whichever archives first creates `openspec/specs/production-identities/spec.md`; the other appends to it.

  sc-2719 (per-household Auth0 app pair) builds on these requirements and references them rather than repeating them.

## Mobile scope

The phone UI has no sign-out of its own inside a budget; it signs out from the user menu on the budget list (`ManagementApp` renders `LoggedInUser` at every width). The mobile app (`packages/mobile-client`, Capacitor) runs the same web build in a WebView and signs in through the same web redirect. One server change and one client change cover web, phone and the mobile app, but the phone and mobile paths get their own scenarios and tests. Electron signs in through the system browser, so its sign-out opens the provider logout there.

## Impact

- `packages/sync-server/src/app-account.js` (`POST /logout`) and `packages/sync-server/src/accounts/openid.ts` (provider logout URL).
- `packages/loot-core/src/server/auth/app.ts` (`subscribe-sign-out` returns the provider logout URL).
- `packages/desktop-client/src/components/LoggedInUser.tsx` and `src/users/usersSlice.ts` (follow the URL on explicit sign-out; Electron through `openURLInBrowser`).
- Auth0 tenant: each sync app needs its server's return URL in "Allowed Logout URLs" (Ken's step; staging first, production when promoting).
