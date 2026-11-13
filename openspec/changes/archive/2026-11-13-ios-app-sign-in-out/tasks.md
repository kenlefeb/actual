# Tasks

Test-first: write the tests, run them and see them fail before writing the code.

## 1. Return to the app after sign-out (sc-3398)

- [x] 1.1 Add a failing test `packages/desktop-client/src/auth/nativeAppHome.test.ts`: a page at the server's address with `WEBVIEW_SERVER_URL` set gets the app's address; a page at the app's address, and a page without `WEBVIEW_SERVER_URL` (a browser), get none. Verify: `yarn workspace @actual-app/web vitest --run src/auth/nativeAppHome.test.ts` fails.
- [x] 1.2 Implement `nativeAppHomeUrl` and call it first in `src/browser-preload.js`, replacing the location when it returns an address. Verify: 1.1 passes; the sign-out e2e tests (`e2e/sign-out.test.ts`, `e2e/sign-out.mobile.test.ts`) are unaffected because a browser has no `WEBVIEW_SERVER_URL`.
- [x] 1.3 In the iOS Simulator, with a local sync server and the e2e OpenID stub (`e2e/fixtures/openid-provider.ts`): sign in with OpenID, sign out from the budget list's user menu, and see the app's own sign-in screen. Verify: screenshots recorded on sc-3398.

## 2. On a device (sc-3398)

- [x] 2.1 (Ken) After merge, in the TestFlight build on production: sign in, sign out, and see the app's sign-in screen; sign in again. Verify: Ken's result recorded on sc-3398. Evidence (accepted by the PO): Ken's sign-in on build 202611111508, Ken's sign-out on build 202611111738 (sc-3398 comment 3566), and offline-then-sync on the Simulator plus Ken's own offline and sync use on his iPhone.
