## Why

When iOS ends the iPhone app's web page process, Capacitor reloads whatever URL the web view last showed, with no limit. A used one-time sign-in callback then dead-ends on an error until the app is force-quit, and a page that keeps dying reloads forever.

## What Changes

- The iPhone app reloads its own start page after the page's process ends, never the last URL.
- It shares the Mac app's cap: three automatic reloads in a minute, then an alert with a Reload button.
- `ReloadGuard` moves into `NativeBridgeCore`, so both apps use the same one.
- Each automatic reload shows a brief notice at the top of the screen that the last change may not have been saved (story 5220). The Mac app's notice is specified in `mac-app`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: adds how the iPhone app recovers when its page's process ends, and the notice it then shows.

## Impact

- `packages/mobile-client/ios/App/App/AppBridgeViewController.swift` and a small navigation delegate in front of Capacitor's handler. Capacitor itself is not patched.
- `packages/mobile-client/ios/NativeBridge` gains `ReloadGuard`, `PageRecovery` and `PageProcessDelegate`; the Mac app uses the shared guard with no change in behaviour.
- After a recovery the page starts at its home screen, so the person returns to the Budget tab rather than the screen they were on.
