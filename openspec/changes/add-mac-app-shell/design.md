# Design

## Context

- **What exists for iPhone.** The iPhone app (Capacitor 8) shows the web build in a `WKWebView` and adds native screens. They reach loot-core through `NativeBridgeCore` (`packages/mobile-client/ios/NativeBridge`), a Swift package that already declares `.macOS(.v12)` and whose tests already run on a macOS runner (`fork-native-bridge.yml`).
- **What doesn't carry over.** The app-target Swift is Capacitor- and UIKit-bound: `NativeBridgePlugin`, `NativeChromePlugin`, `NativeTabBarController`, and views using `navigationBarTitle`, `keyboardType`, `UIAccessibility` and haptics.
- **What the page does today.** It finds its shell in `nativeShell()`, where `'mac'` currently means the Electron app; `style/theme.tsx` and `components/settings/Themes.tsx` use it to pick and hide the theme. On iOS and Android it starts loot-core in a direct Worker (`browser-preload.js`). Inside Capacitor, `browser-preload/start.ts` also turns on the page's `SharedArrayBuffer` fallback mode, because WebKit does not expose `SharedArrayBuffer` on a custom scheme (on macOS 27, `crossOriginIsolated` may still report true; spike finding on sc-4942).
- **The sync server's OpenID return.** `isValidRedirectUrl` accepts a return URL whose host is the server's or `localhost`.
- **Design.** The UX Designer's Figma page "Budget — Mac" (file `2Ts4fUoFzCWfvubD9vgTWx`, node 62-2) has the envelope (light and dark), tracking, Move Money popover, and menu bar, keyboard and VoiceOver frames.
- **Explore findings:** the Architect's comment on sc-4942.

## Goals / Non-Goals

**Goals:**

- Prove that one loot-core runs in a plain `WKWebView` on macOS. That means sign-in, download (including encrypted budgets), persistence and a bridge call, all before any native screen is built.
- Reuse `NativeBridgeCore` and `BudgetViewModel` as they are.
- Ship the native Budget window from the Figma frames.

**Non-Goals:**

- Native onboarding and `ASWebAuthenticationSession` sign-in.
- The Mac chrome (sidebar, menu bar beyond the Budget menu, Settings window): story 4944.
- Electron data migration: story 4943.
- TestFlight: story 4953.
- A shared SwiftUI views package. It waits for Reconcile or Paychecks on the Mac, where form-like views pay back sharing.
- Keyboard bulk work (multi-cell selection, fill and paste, the Budget menu's bulk items): story 4959. Drag a balance onto a category: story 4957. Native onboarding: story 4960.

## Decisions

1. **A plain SwiftUI macOS target, not Capacitor or Catalyst.**
   - Where: `packages/mobile-client/macos/` (`HomeEconomicsMac.xcodeproj`), with a local package dependency on `../ios/NativeBridge`.
   - Target: macOS 14 or later, for SwiftUI `Table` and `AccessibilityNotification.Announcement`.
   - Entitlements: `app-sandbox` and `network.client` only.
   - Why this folder: `check-native-swift.mjs` already scans `packages/mobile-client`, so the database ban covers the Mac sources with no change.
   - Alternatives: Catalyst keeps UIKit idioms and gives no Mac table. Capacitor has no macOS platform.
2. **The engine host is the same staged web build, from a custom scheme.**
   - A `WKURLSchemeHandler` serves `www` (from `bin/stage-www.mjs`) at `homeeconomics://localhost`, using the default persistent `WKWebsiteDataStore` (story 3584's finding). Every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, as `sync-server/app.ts` does.
   - Path handling: percent-decode, standardize, and require the resolved path to start with the build folder's path plus a trailing slash. Reject NUL and backslash; ignore query and fragment.
   - An extensionless path that is not a file gets `index.html`, as Capacitor does, because `/openid-cb` and other client routes are not files. A missing path with an extension gets 404.
   - Why the web build: it brings the page bridge, sign-in, the budget list and the encryption prompt for free.
   - Alternative: the `packages/api` browser worker. It would need a new page bridge and native onboarding (about 1 to 1.5 person-weeks more), so it is kept only as the spike's fallback.
3. **The web view lives in the main window.**
   - The `WKWebView` is the bottom layer of the main window's content. During onboarding it fills the window; with a budget open, the native Budget view covers it.
   - Closing the window orders it out (`applicationShouldTerminateAfterLastWindowClosed` is false). The web view and its engine are kept.
   - The views re-read on `NSApplication.didBecomeActiveNotification` and `NSWorkspace.didWakeNotification`, and the existing `ChangeCoalescer` coalesces events. A small `MacEngineHost` (scheme handler, `actualNativeBridge` message handler, `PageCall` wiring) replaces the roughly 20 lines of logic in `NativeBridgePlugin`.
4. **The page finds the Mac shell by user agent.**
   - The web view sets `applicationNameForUserAgent` to `HomeEconomicsMac/<version>`, so no new user script is needed (user scripts are policed by `check-native-swift`).
   - `nativeShell()` reports the SwiftUI shell as its own value, separate from Electron's `'mac'`.
   - The backend starts with `forceDirectWorker` and the same fallback mode `start.ts` sets for Capacitor. WebKit does not expose `SharedArrayBuffer` on the custom scheme (the spike saw `crossOriginIsolated` report true with `SharedArrayBuffer` undefined), so this is the expected path, not only a fallback. The mode is forced by the shell's flag, not detected, so it stays correct if a later WebKit exposes `SharedArrayBuffer`.
   - The consumers `style/theme.tsx` and `components/settings/Themes.tsx` are updated deliberately. The shell gets the native theme (the onboarding screens are web, and native is preferred), and the theme picker is hidden as on iPhone. The UX Designer confirms this in the shell PR.
5. **Sign-in stays in the web view for M1.**
   - OpenID navigates the main frame to the provider and returns to `homeeconomics://localhost/openid-cb`, which already passes `isValidRedirectUrl` (host `localhost`), as `capacitor://localhost` does on iPhone.
   - A `WKNavigationDelegate` allows in-frame navigation only to the app's scheme and to `https` on the configured sync server and the OpenID provider's host. A plain-`http` server address is refused in-frame. Only an `https` link the user clicks (`linkActivated`) opens in the default browser; a redirect, script navigation or form post to another host is refused and nothing leaves the app, because it can carry the sign-in token or code (PR 413 round 3). The app does not register `homeeconomics://` with the system.
6. **Views on the Mac are new; view models are shared.**
   - The Mac Budget window is a SwiftUI `Table` over `BudgetViewModel` (one `native/budget-month` read per shown month), with 1 to 3 months per Figma.
   - Edits reuse `BudgetAmountWrite` and `Transfer` validation.
   - Arithmetic in a Budgeted cell is evaluated in Swift by a small parser. A contract test runs the same cases as loot-core's `evalArithmetic` (from fixtures that vitest writes), so both agree.
   - Undo: budget writes carry an optional undo token recorded as the undo marker, exactly as paycheck writes do. Command-Z calls `native/undo` with the last token.
   - The one upstream edit is in `packages/loot-core/src/server/budget/app.ts`. The registrations of `budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available` gain a second argument to `undoable` only: a meta function that returns `{ nativeUndoToken }` when a token is sent and `undefined` otherwise. With no token, the marker is exactly today's, so web and iPhone calls are unchanged and upstream merges stay trivial. The page bridge's validators pass the token through.
   - Alternative: `native/` wrapper handlers, like `native/paycheck-save`. They touch no upstream file, but they add three allowlist names and duplicate validation. The one-argument edit is smaller.
7. **Bundle id `app.homeeconomics.budget.mac`** (Ken decided, 2026-11-17, story 4953).
   - It has its own App Store Connect record and its own sandbox container, so it never shares data with the Electron Mac App Store build (`app.homeeconomics.budget`).
   - It moves to the shared id's macOS slot only when it replaces Electron, after story 4943.
   - Development signing is enough for this change.
8. **CI: `.github/workflows/fork-mac-native.yml`.**
   - Runs on pull requests that touch `packages/mobile-client/macos/**` or `packages/mobile-client/ios/NativeBridge/**`.
   - Runs `xcodebuild build test -scheme HomeEconomicsMac -destination platform=macOS CODE_SIGNING_ALLOWED=NO` on `macos-26`.
   - The `www` copy phase skips a missing folder, so the job needs no web build and no secrets.
   - TestFlight dispatch is story 4953.

## Security

- **The sync server's redirect validation is not widened.**
  - The Mac app uses a return URL that already validates (`homeeconomics://localhost`). No change to `isValidRedirectUrl` or the OpenID flow is allowed in this change.
  - That function accepts any scheme with host `localhost` (upstream behaviour, which Electron's `http://localhost:3010` relies on). Pinning it is story 4962.
- **The origin guard covers the custom scheme.**
  - The `PageOriginGuard` server URL is `homeeconomics://localhost`.
  - `PageCall` checks the main frame URL in Swift and `location.origin` in the page.
  - The message handler accepts only main-frame messages from that origin. The provider's pages, the sync server's own web app and any frame are refused.
  - The allowlist is unchanged except for undo tokens on the three budget writes.
- **What is shared with the page.** The scheme handler serves only files inside the bundled `www` directory: no path traversal and no file outside the bundle. Requests for any other host on the scheme fail.
- **The token stays in the engine.** The OpenID token reaches the page by the redirect, as on every platform; Swift never reads or stores it, and no token or budget data goes to Swift logs.
- **Logs.** The OpenID return carries the token in its query, so the scheme handler and the navigation delegate never log a URL's query or fragment. At most they log the path of a refused request.
- **No weakening of WebKit.** No private WebKit API. No `allowFileAccessFromFileURLs` or `allowUniversalAccessFromFileURLs`. COOP and COEP are never dropped. No `evaluateJavaScript` or `WKUserScript` while the main frame is off `homeeconomics://localhost`; `PageCall` already enforces this for page calls. The only fallback for a missing `SharedArrayBuffer` is the page's own direct Worker and fallback mode.
- **Where secrets live.** Budget data, the end-to-end encryption key and the OpenID token all live in the web view's website data (IndexedDB) inside the app's sandbox container, not in the Keychain. At rest, only the sandbox and FileVault protect them, as in the iPhone app and in a browser. Clearing that data on sign-out is story 4963 (out of this change). Native onboarding that keeps tokens in the Keychain is story 4960.
- **Eviction warning.** Swift keeps a non-secret flag in `UserDefaults`: a budget was open, with its cloud file id (never the local id, which holds the budget's name). If the flag is set and the web view has no budget at launch, the app warns that local data was cleared and unsynced changes may be lost, then shows onboarding.
- **Redirect pinning.** Pinning `isValidRedirectUrl` to the apps' exact origins is story 4962, outside this change.
- **Security reviews** the sign-in and sync-download path in the shell PR (story acceptance).

## Risks / Trade-offs

- [WebKit does not expose `SharedArrayBuffer` on a custom scheme, even where `crossOriginIsolated` reports true] → the page runs its direct Worker in the fallback mode the iPhone app already uses (`start.ts`). Nothing in WebKit is weakened. Spike exit criterion 1 confirms that this mode starts, downloads and persists on macOS.
  - If that mode fails on macOS, use the `packages/api` browser-worker bundle with a new page bridge and native onboarding. That re-plans sc-4942 (about 1 to 1.5 person-weeks more) and goes back to the PO before continuing.
- [OpenID in an embedded web view: some providers block embedded sign-in, and passkeys and password-manager autofill are limited. The provider's password page also loads in the app's own web view] → spike exit criterion 2 runs against staging's Auth0. The no-script rule keeps Swift out of the provider's page. If sign-in fails, native sign-in (story 4960) moves into sc-4942.
- [WebKit may evict website data] → the sync server is the source of truth. After eviction the app warns, using the flag kept outside the web view, that unsynced changes may be lost. The user then signs in and downloads again. The page already asks for persistent storage.
- [A hidden or occluded window throttles timers] → the engine stays in the window, views re-read on activation and wake, and every call keeps the 5 s timeout and sync's 30 s deadline. Spike exit criterion 3 measures it.
- [Duplicated views between iPhone and Mac] → accepted for the Budget, whose layouts differ. Revisit when a second screen reaches the Mac.

## Migration Plan

- New app. Nothing is migrated: Electron stays installed and unchanged, and the Mac app downloads budgets from the server.
- Rollback: stop using the Mac app. Its sandbox container holds only a re-downloadable copy.

## Open Questions

- Whether the web screens in the Mac app use the native theme (decided with the UX Designer in the shell PR). It doesn't change the specs or tasks.
