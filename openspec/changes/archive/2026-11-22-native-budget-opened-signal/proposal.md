# Proposal

## Why

Story sc-5496 (blocks sc-5463; required before the first TestFlight build that carries the storage guard). `native-open-gate` makes native reads wait while a budget opens, but only for a limit (4 s today). A cold open can take longer: the first launch after an upgrade runs migrations. The reads then answer `budget-not-open`, the native screen shows its failed state with Retry, and nothing re-reads it: the page posts `ready` once, as soon as its bridge installs, and later events (`sync-event`, `cells-changed`) do not come unless something changes. A person is left on Retry although the budget opened a moment later.

## What Changes

- loot-core sends a `budget-opened` event right after it marks a budget open (in `_loadBudget`, beside `markBudgetOpen()`); the page forwards it to native code like `cells-changed`. No payload.
- A native screen that has not loaded (failed, or still loading) re-reads on it; a loaded screen ignores it. The logic is in the shared view models, so the iPhone and the Mac shell both get it.
- A test-only slow-open hook (a build constant, compiled out of production like the other `__FORK_TEST_*` hooks and refused by `check-test-hooks` and the iPhone Release build phase) delays the open, so a test can show a read made during a slow open ending in a loaded screen with no tap on Retry.
- No new wait or timeout: the open wait of `native-open-gate` is unchanged.

Mobile scope: the three native screens that read on `ready` (Accounts, Budget, Paychecks) on the iPhone, and the native Budget window on the Mac shell. The web UI is unchanged: its client ignores the event.

Not in this change: re-reading a loaded screen after a budget switch (see the design's open questions); the setting for the open wait (sc-5463's review).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: new requirements "The page forwards when the budget finishes opening", "A native screen that has not loaded re-reads when the budget opens", "A slow open is testable". ADDED only.

## Impact

- **Code:** `packages/loot-core/src/server/budgetfiles/app.ts` (event, hook), `packages/loot-core/vite.config.mts`, `packages/desktop-client/src/native/nativeBridge.ts` (`EVENTS`), `fork/scripts/check-test-hooks.mjs` (markers), the three shared view models and the shells' event routing in `packages/mobile-client`, Fork CI test builds.
- **Screens:** a launch with a slow open ends loaded instead of on Retry.
