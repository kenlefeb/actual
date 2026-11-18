# Proposal

## Why

ADR 11's gate for the Mac app is met: the iPhone bridge benchmark passed on device (sc-3593) and the native iPhone Budget screen has shipped. Electron can't host SwiftUI, so the Mac needs its own SwiftUI app, running the same loot-core engine, beside the Electron app until it covers Ken's daily use (parent sc-3629). This change is the first slice: the app shell and its engine host, which is also the spike (sc-4942), then the native Budget window, read-only (sc-4951) and with edits (sc-4952). The Architect's Explore findings are on sc-4942.

## What Changes

- A new SwiftUI macOS app at `packages/mobile-client/macos/`. It hosts loot-core in a `WKWebView` that stays inside its main window. The web view loads the same staged web build the iPhone app ships, from the app's own scheme at `homeeconomics://localhost`.
- For M1, onboarding uses the existing web screens in that window: server URL, sign-in (including OpenID), the budget picker and the end-to-end encryption password. A budget opens only by sync download, like a new device, and never from the Electron app's files.
- The web page recognizes the Mac shell and starts its engine in a direct Worker, as it already does on iOS and Android.
- Swift reaches loot-core only through the existing native bridge (`NativeBridgeCore`, unchanged and shared with iPhone). The origin guard expects `homeeconomics://localhost`.
- The native Budget window on Mac (sc-4951, sc-4952), on the iPhone's `BudgetViewModel`, following the UX Designer's Figma page "Budget — Mac" (node 62-2):
  - a dense table of 1 to 3 months, month navigation from the keyboard, inline budgeted editing with arithmetic, Command-Z undo;
  - move money and cover overspending in a popover;
  - Dark Mode and VoiceOver;
  - a switch back to the web Budget screen.
- A new Fork CI workflow, `fork-mac-native`, builds and tests the Mac app on PRs that touch it.
- Out of scope, each with its own story:
  - TestFlight distribution (sc-4953);
  - Electron data migration (sc-4943);
  - Mac chrome: sidebar, menu bar and the Settings window (sc-4944);
  - native sign-in with `ASWebAuthenticationSession`;
  - the Budget menu's bulk items (Copy Last Month, 3-Month Average, Zero), copy and paste of amounts, and dragging a balance onto a category;
  - every other Mac screen (sc-4622).

## Capabilities

### New Capabilities

- `mac-app`: the SwiftUI Mac app shell. It covers the engine host and its origin, how the engine stays attached and survives sleep, web onboarding and sync-download-only budgets, storage eviction, running beside Electron, the page's Mac-shell detection, and its CI.

### Modified Capabilities

- `native-budget-screen`: adds the Mac Budget window's scenarios (read, month navigation, edits, move money, the switch, change events, wake, accessibility).
- `native-bridge`: adds the Mac app's expected origin, `homeeconomics://localhost`, and undo tokens on native budget writes (for Command-Z on the Mac).

## Impact

- **Mobile scope:** none changes. The iPhone app and the web phone screens are untouched. The Mac Budget window is the desktop counterpart of the shipped iPhone Budget tab, which already covers mobile.
- **Code:**
  - new `packages/mobile-client/macos/`;
  - a small change in `packages/desktop-client` (shell detection and the direct Worker; the undo token in the page bridge's budget-write validation);
  - an additive, optional undo-token marker on loot-core's budget write handlers (ADR 4);
  - a new workflow `.github/workflows/fork-mac-native.yml`.
  - `NativeBridgeCore` is reused, gaining only typed undo tokens on budget writes.
- **Security:** a new custom-scheme origin and an OpenID return to it. The sync server's redirect validation is not widened. See the design's Security section.
- **Bundle id (Ken decided, 2026-11-17, sc-4953):** the Mac app is `app.homeeconomics.budget.mac`, with its own App Store Connect record, while it runs beside Electron. The shell PR uses development signing. TestFlight distribution stays in its own story, sc-4953, outside this change.
