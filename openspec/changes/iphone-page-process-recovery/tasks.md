# Tasks

## 1. Reload the app's own page, with the shared cap (sc-5247)

- [x] 1.1 Move `ReloadGuard` into `NativeBridgeCore` and add `PageRecovery` and `PageProcessDelegate`, tests failing first. Verify: `swift test` and the Mac tests pass.
- [x] 1.2 Put the delegate in front of Capacitor's handler in `AppBridgeViewController`; reload through `loadWebView`, and show the alert when the cap is reached.
- [x] 1.3 Add UI tests for a used callback, three reloads and the fourth end. Verify on the simulator.
- [x] 1.4 Kill the page's real process on the simulator. Verify the page reloads, and the alert appears after the fourth kill in a minute.

## 2. Notice on each automatic reload (sc-5220)

- [x] 2.1 `PageRecovery` reports each automatic reload, including the capped fallback, and the alert; `WindowNotices` holds the one notice slot, tests failing first. Verify: `swift test` passes.
- [x] 2.2 Show the strip at the top of the screen, moving the screens below it down, with Dismiss and a VoiceOver announcement. Verify with UI tests on the simulator.
- [ ] 2.3 Screenshots in light, dark and the largest accessibility size for the UX Designer, who approves placement and wording.
