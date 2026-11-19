# Tasks

## 1. Reload the app's own page, with the shared cap (sc-5247)

- [x] 1.1 Move `ReloadGuard` into `NativeBridgeCore` and add `PageRecovery` and `PageProcessDelegate`, tests failing first. Verify: `swift test` and the Mac tests pass.
- [x] 1.2 Put the delegate in front of Capacitor's handler in `AppBridgeViewController`; reload through `loadWebView`, and show the alert when the cap is reached.
- [x] 1.3 Add UI tests for a used callback, three reloads and the fourth end. Verify on the simulator.
- [x] 1.4 Kill the page's real process on the simulator. Verify the page reloads, and the alert appears after the fourth kill in a minute.
