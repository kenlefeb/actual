# Tasks

Test-first: in each group, write the tests, run them and see them fail before writing the code. The provider stays mocked as in `packages/sync-server/src/app-account.test.js` (stub `Issuer.discover` with an `end_session_endpoint`) and the e2e stub `packages/desktop-client/e2e/fixtures/openid-provider.ts`; no test reaches a real provider.

## 1. Server: store the ID token and send it as the hint (sc-2970)

- [x] 1.1 Add failing tests to `packages/sync-server/src/app-account.test.js` (`describe('logout from an OpenID session')`): a session row with `id_token` set gives a `providerLogoutUrl` whose params are `client_id`, `post_logout_redirect_uri` and `id_token_hint` equal to the stored token; a row with `id_token` NULL gives exactly today's params (no `id_token_hint`); after logout the row, and so the token, is gone; with the stub `Issuer.discover` throwing, the answer is still 200 with `data: {}`; the Auth0 `/v2/logout` fallback never carries the hint. Verify: `yarn workspace @actual-app/sync-server test app-account` fails on the hint cases only.
- [x] 1.2 Add failing tests to `accounts/openid.test.ts` for `loginWithOpenIdFinalize`: the inserted session row has `id_token` equal to the stub `tokenSet.id_token`; it is NULL when the token set has no ID token; no row is inserted when the `aud`/`azp`/`sub` checks fail. Verify: they fail.
- [x] 1.3 Add a failing test that `getSession` (and so `validateSession`) returns no `id_token` field, and that a request to an authenticated route (for example `GET /validate`) carries no ID token in its body. Verify: it fails while `getSession` selects `sessions.*`.
- [x] 1.4 Add a migration test (in `src/migrations.test.ts` or a new test next to the migration) that `up` adds a nullable `id_token` column to `sessions`, existing rows read NULL, and `down` removes it. Verify: it fails before the migration exists.
- [x] 1.5 Implement design decisions 1 to 4: the migration in `packages/sync-server/migrations/`, the insert in `loginWithOpenIdFinalize`, `getProviderLogoutUrl(idToken)`, the `/logout` select, and the explicit column list in `getSession`. Verify: 1.1 to 1.4 pass, the existing sign-out, OpenID and migration tests still pass, and `yarn typecheck` and `yarn lint` are clean.

## 2. Desktop end-to-end (sc-2970)

- [x] 2.1 Extend the e2e OpenID stub to remember the ID token it issued per user, and add a failing assertion to `e2e/openid-sign-out.ts` (used by `e2e/sign-out.test.ts`) that the stub's `/logout` request carries `id_token_hint` equal to the token issued at sign-in. Verify: `yarn workspace @actual-app/web run playwright test sign-out.test.ts --browser=chromium` fails on that assertion before group 1 is implemented and passes after.

## 3. Mobile end-to-end (sc-2970)

- [x] 3.1 The same assertion runs in `e2e/sign-out.mobile.test.ts` (phone width; the mobile app runs this same web build in a WebView, as its header comment records). Verify: `yarn workspace @actual-app/web run playwright test sign-out.mobile.test.ts --browser=chromium` passes, and the test's header names sc-2970 next to sc-2915.

## 4. Staging verification (sc-2970)

- [ ] 4.1 On staging, with the staging test users from "Ken & Agents": sign out on desktop web, Electron, phone width and the mobile app; each returns to Actual's sign-in page with no Auth0 confirmation page, and the next sign-in asks for credentials. Verify: the Tester records the result on sc-2970.
- [ ] 4.2 On staging, sign out with a session created before the deploy (confirmation page as before, then the sign-in page) and with a session older than its ID token's `exp` (design, Risks). Verify: the Tester records both results on sc-2970; if Auth0 rejects the expired hint, file a follow-up story in epic 1550 and link it here.

## 5. Release note (sc-2970)

- [x] 5.1 Add `upcoming-release-notes/openid-sign-out-no-confirmation.md` (category `Bugfix`, author `kenlefeb`): "Signing out of a server that uses OpenID no longer stops at the identity provider's "Are you sure?" page." No version bump and no fork-news change; releases are cut separately. Verify: the file follows the template in `packages/docs/docs/contributing/index.md`.

## Workflow follow-up

- Archive this change when sc-2970 is Done. If `openid-true-sign-out` has not archived by then, archive it first so its sign-out requirements land in the main spec before this one's.
