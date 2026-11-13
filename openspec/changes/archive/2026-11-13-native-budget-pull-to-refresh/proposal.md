# Proposal

## Why

Shortcut sc-3884. Ken tested TestFlight build 202611122252 (native Budget screen) and it passed, but he found that the app pulls from the sync server only when he returns to it, or after he makes a local change. To see a change from another device he had to leave the app and come back. He asked for a way to force a sync without leaving.

The native Budget tab (`add-native-budget-screen`, sc-3796) already re-reads on `cells-changed` and `sync-event`, so it needs only a way to start a sync. ADR 11 (`docs/adr/0011-native-ui-without-upstream-parity.md`) forbids native code from talking to the sync server, so the trigger must be an allowlisted bridge call into loot-core.

## What Changes

- **Delta to `native-bridge`.** loot-core's existing `sync` handler joins the allowlist, on the Swift and the page side, as a named exception to "reads and budget writes". Swift calls it with no arguments through one typed method. The page reduces loot-core's result to `{ok: true}` or `{ok: false, reason}` with a fixed set of reason codes, so no server address, message, `meta` or CRDT data crosses the bridge. A `sync` call gets a 30 second deadline instead of the 5 second default.
- **Delta to `native-budget-screen`.** Pulling down on the native Budget tab calls `sync`, then re-reads the visible month once, then ends the spinner. A failure, or the deadline, keeps the last good numbers on screen (marked stale) and shows a fixed message for the reason. The pull never runs bank sync.
- **The web screens keep their existing gesture.** The mobile web Budget, Accounts and account transactions screens already wrap their lists in `PullToRefresh`. A task verifies on a device that it works inside the iOS app's WKWebView. If it does not, the fix goes there; no second gesture and no global "Sync now" button.
- **No new loot-core handler and no loot-core change.** The web's own sync path is reused, and its `once` wrapper makes a pull share one run with a focus sync.

Out of scope: bank sync on native Accounts (sc-3899, Backlog, needs its own allowlisted call and a Security review); polling or periodic sync while the app is open (decided against, see `design.md`); background fetch and push; a gesture on web screens that have none (Reports, Schedules, Settings); Android and the Mac app.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: the allowlist gains `sync`, with its result shape, deadline and error rule. (The spec lives in the still-open changes `native-bridge` and `add-native-budget-screen`; this delta is written against them and applies once they are archived.)
- `native-budget-screen`: pull-to-refresh on the Budget tab. (Same note: the base requirements are in `add-native-budget-screen`.)

## Mobile scope

This change is iOS-native only, by nature. Desktop and the browser already sync live: the web app syncs on focus and visibility, after each local change, and from its sync control, and its mobile web screens already pull to refresh. Nothing changes there, and Android and mobile web are untouched. The one screen that changes is the native Budget tab in `packages/mobile-client/ios/` and the platform-free `NativeBridgeCore` package. ADR 11 sets native screens as Apple-only with no upstream parity (Ken, 2026-11-11), the recorded exception to the desktop-and-mobile rule. Native Accounts (sc-3611) inherits the gesture and the `sync` call when it ships.

## Decisions for Ken

None. The decisions are the Architect's, accepted by the Product Owner on sc-3884, in `design.md`.
