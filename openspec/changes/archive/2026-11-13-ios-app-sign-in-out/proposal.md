# Proposal

## Why

Shortcut sc-3398, slice 2 (Architect plan in its comment #3408). The fork's iOS app (Capacitor, slice 1) signs in to Ken's server through OpenID inside its WebView. "Sign out" sends the WebView to the provider's logout, and the provider returns it to the server's own address (`openid-true-sign-out`). In the app that address loads the server-hosted copy of Actual inside the app, not the app's own bundled copy, so the user ends up on a sign-in page that is not the app's.

## What Changes

- When Actual's web code starts inside the iOS app but was loaded from a server (Capacitor injects `WEBVIEW_SERVER_URL`, the app's own address, into every page), it goes straight back to the app's own address, which shows the app's sign-in screen. Browsers and Electron have no `WEBVIEW_SERVER_URL`, so nothing changes there.
- The provider logout address, its return URL and the server are unchanged: the return URL still comes from the server's config only.

Out of scope: Android (sc-3419), the Mac app (sc-3410), and ASWebAuthenticationSession sign-in.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `production-identities`: adds one requirement, that the iOS app signs in and out without leaving the app's own copy of Actual. The sign-out requirements it builds on come from the active change `openid-true-sign-out`, not archived yet, so this change adds a requirement rather than modifying one (as `openid-logout-id-token-hint` does).

## Mobile scope

Mobile-only by nature: the requirement is about the iOS app, which shows the phone screens (the budget list's user menu holds "Sign out"). Desktop web and Electron are unaffected; their scenarios in `openid-true-sign-out` still apply.

## Impact

- `packages/desktop-client/src/auth/nativeAppHome.ts` (new) and `src/browser-preload.js`.
- `src/components/manager/ManagementApp.tsx`: the budget list's user menu (which holds "Sign out") sits below the status bar (`env(safe-area-inset-top)`, 0 in browsers); in the app it was under the status bar and could not be tapped.
- No server, Auth0 tenant or hosting change.
