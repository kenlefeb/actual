# Tasks

Test-first: in each group, write the tests, run them and see them fail before writing the code. The provider is mocked the way `packages/sync-server/src/accounts/openid.test.ts` already mocks `openid-client` (a stub `Issuer.discover`); no test reaches a real provider.

## 1. Server: `/logout` returns the provider logout address

- [x] 1.1 Add failing tests to `packages/sync-server/src/app-account.test.js` (`describe('logout')`) and `accounts/openid.test.ts`, with the mocked issuer: an `openid` session gets `data.providerLogoutUrl` built from the stub `end_session_endpoint` with `client_id` and `post_logout_redirect_uri` equal to `new URL('/', server_hostname)`; with no `end_session_endpoint` and an issuer whose parsed hostname is `auth0.com` or ends in `.auth0.com`, the URL is `https://<host>/v2/logout?client_id=…&returnTo=…`; any other issuer without the endpoint, including the look-alikes `evil-auth0.com` and `auth0.com.evil.example`, gives `data: {}` and logs a warning; a `password` session and an unknown token give `data: {}`; a `returnTo` or similar field in the request body is ignored. Verify: `yarn workspace @actual-app/sync-server test app-account openid` fails on these cases only.
- [x] 1.2 Add a failing test that the session row is gone even when the stub `Issuer.discover` throws, and the answer is 200 with `data: {}`. Verify: it fails before 1.3.
- [x] 1.3 Implement design decisions 1 to 3 in `app-account.js` and `accounts/openid.ts` (read the row, delete it, then build the URL; log and drop errors). Verify: the tests from 1.1 and 1.2 pass and the existing `logout` and OpenID tests still pass.

## 2. Core: `subscribe-sign-out` passes the address on

- [x] 2.1 Add failing tests next to `packages/loot-core/src/server/auth/app.ts` (new `app.test.ts`, mocking `post`): with `{ endProviderSession: true }` it returns the server's `providerLogoutUrl`; without it, it returns none; in both cases, and when `post` rejects, `user-token`, `encrypt-keys`, `lastBudget` and `readOnly` are removed before it returns. Verify: `yarn workspace @actual-app/core run test auth/app` fails on the new cases.
- [x] 2.2 Implement the optional argument and return value (design decision 4) and update the handler type. Verify: 2.1 passes and `yarn typecheck` is clean.

## 3. Desktop: the user menu leaves the provider (web and Electron)

- [x] 3.1 Add failing tests for `LoggedInUser` (new `LoggedInUser.test.tsx`, `send` mocked): choosing "Sign out" calls `subscribe-sign-out` with `endProviderSession: true` and then `window.location.assign` with the returned URL; with `isElectron()` true it calls `window.Actual.openURLInBrowser` instead and does not leave the app window; with no URL it only shows the sign-in page; a returned `javascript:`, `file:`, `data:` or unparseable URL, or `http:` to a non-localhost host, is never assigned or opened and the sign-in page shows, while `http://localhost:…` is followed. Render it once at desktop width and once at phone width (`useResponsive` narrow) inside `ManagementApp`, so the test also shows the menu and its "Sign out" item are present on the phone budget list. Verify: the test fails.
- [x] 3.2 Add a failing test that the automatic callers (session expiry in `sync-events.ts`, `ConfigServer.tsx`) do not pass `endProviderSession` and never navigate to a provider. Verify: it fails against an implementation that always follows the URL.
- [x] 3.3 Implement design decision 4 in `usersSlice.ts` (the thunk takes the flag and returns the URL) and `LoggedInUser.tsx` (the menu follows it after the thunk resolves, only after the scheme check). Verify: 3.1 and 3.2 pass; `yarn lint` and `yarn typecheck` are clean.

## 4. Mobile: the phone UI and the mobile app

- [x] 4.1 Add a Playwright mobile test (`packages/desktop-client/e2e/sign-out.mobile.test.ts`) against a sync server configured with a mocked OpenID provider (a local stub serving discovery and an end-session page that redirects to `post_logout_redirect_uri`): sign in, sign out from the budget-list user menu, assert the stub's end-session page was requested with the server's return URL, and that the app lands on the sign-in page. Verify: `yarn workspace @actual-app/web run playwright test sign-out.mobile.test.ts --browser=chromium` passes. The mobile app (Capacitor) runs this same web build in a WebView, so this test covers its code path; record that in the test's header comment.
- [x] 4.2 Add the desktop twin (`e2e/sign-out.test.ts`) using the same stub. Verify: the same command with `sign-out.test.ts` passes.

## 5. Staging and production (Auth0 tenant)

- [ ] 5.1 Write Ken's checklist (in the PR body or the story, reviewed by the Checklist Reviewer) for Ken's steps below (5.2 and 5.5), each with exact text and a "why you" line. Verify: the Checklist Reviewer approves it.
- [ ] 5.2 (Ken) In the Auth0 tenant `actual-staging.us.auth0.com`, open the staging sync application and add `https://actual-staging.owl-becrux.ts.net/` to "Allowed Logout URLs". Why Ken: only Ken administers the tenant; agents have no tenant access by design.
- [x] 5.3 Fetch the tenant's public discovery document (`https://actual-staging.us.auth0.com/.well-known/openid-configuration`) and record on sc-2684 whether `end_session_endpoint` is present, so the tester knows which path staging exercises. Done 2026-11-07 while revising this change: present, `https://actual-staging.us.auth0.com/oidc/logout` (see design decision 2); re-check only if the tenant changes. Verify: the result is on sc-2684.
- [ ] 5.4 Verify on staging with the staging test users from "Ken & Agents": desktop web, Electron, phone width and the mobile app each sign out, land on the sign-in page, and the next sign-in asks for a username; a second test user signs in right after. Verify: the Tester records the result on sc-2684.
- [ ] 5.5 (Ken) When promoting this release to production, add `https://actual-production.owl-becrux.ts.net/` to "Allowed Logout URLs" of the production sync application (client id in actual-hosting `production/households/ken.json`, `auth0.sync_client_id`). Why Ken: tenant admin, and production changes are Ken's gate. Verify: Ken signs out of production once and lands on its sign-in page.

## 6. Release note

- [x] 6.1 Add `upcoming-release-notes/openid-true-sign-out.md` (category `Bugfix`, author `kenlefeb`): "Signing out of a server that uses OpenID now also signs you out of the identity provider, so the next sign-in asks who you are." No version bump or fork-news change; releases are cut separately. Verify: the file follows the template in `packages/docs/docs/contributing/index.md`.

## Workflow follow-up

- Archive this change when sc-2684 is Done. If it archives before `production-identities`, the main spec it creates holds only these requirements; `production-identities` then appends its own.
