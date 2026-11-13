# Design

## Context

See `proposal.md`. Facts about the code, measured on `development` on 2026-11-12:

- loot-core's sync entry point is the `sync` handler (`packages/loot-core/src/server/sync/app.ts`), which returns `fullSync()` from `sync/index.ts`. `fullSync` is wrapped in `once`, so overlapping calls share one run. It returns `{ messages }`, or `{ error: { message, reason, meta } }`, and emits `sync-event` (start, success, error). The error reasons are `network-failure`, `unauthorized`, `out-of-sync`, `clock-drift`, `encrypt-failure`, `decrypt-failure`, `invalid-schema` and anything else a `PostError` carries.
- The web triggers go through the `sync` thunk (`send('sync')`, then `loadPrefs()`). Focus is `useOnVisible`; a local change is the debounced `fullSync`. The mobile web Budget, Accounts and account transactions screens already pull to refresh with `components/mobile/PullToRefresh.tsx`.
- `NativeBridgeClient` (`NativeBridgeCore`) refuses names off `NativeBridgeAllowlist.handlers`, applies a 5 second timeout (`defaultTimeout`) to every call, and sends writes only as typed values (`NativeBridgeAllowlist.writes`). Every call into the page goes through `PageCall` and `PageOriginGuard` (sc-3859). The page copy of the allowlist is `packages/desktop-client/src/data/native-bridge-allowlist.json`; tests compare the two.
- `BudgetViewModel` has one generation-counted read path (`read`, used by `load`, change events and saves) and a `.stale(BudgetMonth, BudgetLoadError)` state that keeps the last good numbers.

## Goals / Non-Goals

**Goals**

- Ken can force a sync from the native Budget tab without leaving the app, and sees the new numbers.
- A failed or slow sync never loses the numbers on screen and never reveals the server.

**Non-Goals**

- No bank sync (sc-3899), no polling, no new loot-core handler.

## Decisions

### 1. Allowlist the existing `sync` handler

No new `native/sync` handler. `sync` is the web's own path, and `once` coalesces a pull with a focus sync. The existing allowlist rule ("batched reads, `query` and the named budget writes") gains one named exception. `sync` is not in `NativeBridgeAllowlist.writes`: that set holds handlers that take a typed value, and `sync` takes none. Swift sends it only through `client.sync()`, which passes no arguments, and `call` refuses the name with any other call shape. Alternative: a fork-only `native/sync` that returns the reduced result itself. Rejected: it duplicates `sync` for the sake of a result shape the page can produce, and it puts fork code in loot-core.

### 2. The page reduces the result; only a reason code crosses

The page bridge calls `send('sync')` and returns `{ok: true}` when loot-core returns no `error`. On an error it maps `reason`: `network-failure` to `network`, `unauthorized` to `unauthorized`, `out-of-sync` to `out-of-sync`, `clock-drift` to `clock-drift`, `encrypt-failure` and `decrypt-failure` to `encryption`, and anything else, including `invalid-schema` and unknown values, to `other`. It returns `{ok: false, reason}`. `messages` (raw CRDT data), `message` and `meta` are dropped there: `message` and `meta` can carry the server address or a response body. Swift decodes the reason into a closed enum, so an unknown string from a stale page is `other`. The mapping lives on the page because it is the only place that sees loot-core's raw error, and Swift's decode covers a page that is older or newer than the app. No credential crosses either way: the sync token stays in loot-core.

`unauthorized` also puts loot-core into read-only mode. That is existing behaviour and the web shows its own notification for it; the native tab shows its fixed message and does not clear the flag.

### 3. A 30 second deadline, with no polling and no retry

A sync can take longer than the 5 second read default, so `NativeBridgeClient` takes a per-call deadline and `sync()` passes 30 seconds. Reads and writes keep 5. The deadline only stops the spinner: loot-core keeps syncing, and when it finishes the existing `sync-event` subscription re-reads the month (sc-3796). That is safe because a sync is idempotent. A timeout is not retried, and the screen does not re-read on a timeout, because the event will. A second pull while one is in flight does nothing; the view model holds one refresh at a time, and loot-core's `once` would coalesce them anyway.

### 4. The pull re-reads through the one read path

`BudgetViewModel.refresh()` calls `client.sync()`; on `{ok: true}` it awaits the existing `load()` (the generation-counted read), then returns, which ends the system spinner. On `{ok: false}` it keeps the state and sets `refreshError`. The numbers never come from the sync result; they always come from a `native/budget-month` read, so ADR 11's "Swift never stores totals" holds. If the sync succeeds and the re-read fails, the state becomes `.stale` through the existing path and the error is `refreshFailed`, as for a failed save. The view shows the error inline under the navigation bar (not an alert), in fixed local strings per reason: `network` "You're offline. Showing the last numbers."; `unauthorized` "Sign in again to sync."; timeout "Still syncing. The screen updates when it finishes."; every other reason "Couldn't sync. Try again." The strings are Swift constants; nothing from the page is displayed. VoiceOver announces the result. The gesture is the system `UIRefreshControl`, through SwiftUI `refreshable`. No refresh starts while the scene is not active.

### 5. One mechanism: pull-to-refresh everywhere, no "Sync now" button

Native screens use the system refresh control. Web screens keep `PullToRefresh`. A global button is one more control in the chrome for something the gesture already does. A `UIRefreshControl` on the WKWebView's `scrollView` is rejected: the web screens scroll inner elements, so it would rarely fire, and it would fight the web gesture. The web gesture inside the WKWebView has not been confirmed on a device, so a task verifies it, and fixes it if it fails. Web screens with no gesture (Reports, Schedules, Settings) still sync on focus and after edits; left alone unless Ken asks.

### 6. Do not poll while the app is open (not planned)

loot-core already syncs after every local change, on every return to the app, and now on demand. Ken's household has few devices, so a poll would mostly fetch nothing, at a cost in battery and data. Timers in the web view do not run in the background, and a foreground poll adds bridge traffic that competes with the screen's reads. If Ken still misses changes after this ships, the follow-up is a server push that triggers a sync, not a timer. Decision recorded; no split story.

### 7. Testing

Test-first, per ADR 11: vitest for the page reduction and allowlist equality; `swift test` for the client (allowlist, no-argument rule, 30 second deadline, reason decode), the origin guard and the view model against a fake transport. `check-native-swift` runs in Fork CI as today. The device checks (the web gesture, and a change from a second client appearing after a pull) record their evidence on the story; they need Ken's iPhone and a TestFlight build, which the Director arranges.

## Risks / Trade-offs

- [A raw server error leaks through the result] → the page returns a closed shape it builds itself; Swift decodes a closed enum; tests assert that a result carrying a URL in `message` and `meta` yields only the reason.
- [The 30 second deadline fires and the user pulls again] → loot-core's `once` shares the run, and the in-flight guard ignores the second pull.
- [`unauthorized` leaves the app read-only] → existing behaviour; the tab says to sign in again.
- [The web gesture does not fire in the WKWebView] → found by the device task; fixed there, not worked around with a second gesture.
- [The base specs are in open changes] → this delta is written against them and archives after them; if the names differ at archive time, the requirement text moves with them.

## Migration Plan

No data migration, no switch of its own: it ships inside the native Budget screen, which is behind the per-screen switch (default off). Rollback is turning that switch off.

## Open Questions

None. Follow-up already filed: sc-3899, bank sync on the native Accounts pull.
