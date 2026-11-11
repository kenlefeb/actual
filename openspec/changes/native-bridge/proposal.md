# Proposal

## Why

Shortcut sc-3584. ADR 11 (`docs/adr/0011-native-ui-without-upstream-parity.md`) chooses native SwiftUI screens over the one loot-core, which keeps running in the app's WebView. Every native screen depends on one unproven thing: that a native screen can read a budget month through the WebView fast enough. This change adds the bridge and measures it before any native screen is built.

## What Changes

- **Batched read handler.** A fork-only loot-core handler, `native/budget-month`, returns one month's snapshot in one message: every group and category with budgeted, spent and balance, plus the month totals. It serves envelope and tracking budgets with one shape.
- **Allowlisted bridge.** The page exposes a bridge that forwards only allowlisted handlers to loot-core's `send()`. A Capacitor iOS plugin calls it from Swift and refuses any other name before it reaches the page.
- **Change events.** The bridge forwards `cells-changed` and `sync-event` to native code, which coalesces a burst of them into one re-read.
- **No native database access.** Swift code never opens SQLite and never writes; a fork check fails CI if a Swift source imports SQLite or names a `.sqlite` path.
- **Latency gate.** A round trip for a 300-category month must take under 50 ms. The spike measures it in the iOS Simulator; the real-device number comes from TestFlight on Ken's iPhone.

Out of scope: any native screen, write handlers on the allowlist (each native screen story adds the ones it needs), and the Mac SwiftUI app.

## Capabilities

### New Capabilities

- `native-bridge`: the contract between native Apple screens and loot-core running in the app's WebView: the allowlist, the batched read views, change events, the no-native-writes rule and the latency gate.

### Modified Capabilities

None.

## Mobile scope

No screen changes. The bridge is iOS-only plumbing with no UI, so the desktop-and-mobile rule's exemption for features with no UI applies. The web app and Android are unchanged: the page-side bridge is installed only inside the iOS app.
