# Design

## D1. Where the event comes from

loot-core sends it with `connection.send('budget-opened')` right after `markBudgetOpen()` in `_loadBudget`, so it fires exactly when reads can be served and on every open (a switch or a reopen included). The page adds `'budget-opened'` to the `EVENTS` list in `nativeBridge.ts`, so it is forwarded like `cells-changed` and goes through the same inbound origin guard. `markBudgetOpen` itself stays free of I/O.

Rejected: loot-core telling the shell directly. The shells talk only to the page (ADR 11), and the page already forwards loot-core events. The web build is unchanged: with no native handler the page posts nothing, and the web client has no listener for the event.

No event on a failed open: `_loadBudget` returns before `markBudgetOpen()`.

## D2. What a native screen does

Each shared view model (`AccountsListViewModel`, `BudgetViewModel`, `PaychecksViewModel`) gets `budgetOpened()`, ignore while the scene is in the background (the read on returning covers it); a screen that is failed or still loading re-reads once. (`pageReady()` differs: it re-reads on anything not `.loaded`. This requirement is the authority.) A new `load()` supersedes one in flight (the `generation` counter already does this), so a read that timed out at the gate just before the event cannot leave the screen failed: its late failure is dropped. A screen showing a value (loaded or stale) ignores the event. One event causes at most one read; a failed re-read stays failed with Retry and waits for the next event, so there is no loop.

The shells route `budget-opened` only to `budgetOpened()` and return before everything else they do with an event. Neither shell filters event names today: the iPhone `NativeBridgePlugin` sends every event to `onEvent`, `onPaychecksEvent` and `coalescer.notify()`, and `MacEngineHost.receive` sends every event to `onEvent` and `coalescer.notify()`; `BudgetViewModel.changeEventReceived()` guards only on the scene being active. Unrouted, `budget-opened` would re-read a loaded Budget screen through that change path. So the shells return after `budgetOpened()`, before the coalescer, `onChange` and `onPaychecksEvent`.

A loaded screen after a switch to a different budget is left alone. Not planned: a follow-up only if a native screen ever outlives a switch.

## D3. Order and races

- Before the screen asked: it is in its first `.loading` state, so it reads now; the `ready` read that follows is the existing duplicate-tolerant path.
- Twice (a switch or reopen): the second finds `.loaded` and does nothing.
- During a read in flight: supersedes it (D2). The extra read is cheap and idempotent.
- The page reloads (iPhone process recovery): the new page posts `ready` and its own open then sends the event, so a screen left failed re-reads.
- The event posted before the page's bridge was listening cannot be lost harmfully: the bridge installs before the reopen starts, and if it did, the open was done before `ready`, whose read then succeeds.

## D4. Failure

If the open never completes, no event comes: the screen keeps its failed state and Retry, as today.

## D5. Interaction with native-open-gate

The gate and its wait are unchanged and still answer a read promptly (under the bridge's read deadline) so a screen never hangs; the event covers opens longer than the wait. This change adds no wait, timeout or constant, so it adds no setting. The setting for the existing 4 s wait is for the `native-open-gate` review (sc-5463).

## D6. The slow-open test hook

`__FORK_TEST_SLOW_OPEN_MS__`, a build constant defined in `packages/loot-core/vite.config.mts` from `FORK_TEST_SLOW_OPEN_MS` only when `FORK_TEST_HOOKS` is true (0 otherwise), like `__FORK_TEST_FAIL_STORAGE_AFTER_MS__`. In `_loadBudget`, under `typeof ... !== 'undefined' && __FORK_TEST_HOOKS__`, it awaits that many ms just before `markBudgetOpen()`, while the load still counts as pending. Tests set it above the open wait plus margin (the iPhone UI test uses 10000 ms), so a read made during the open is refused by the gate. Where the screen has no numbers and is wired to the signal alone (the Mac pair), only the event can load it. It is build time only: it must act on the cold open, before any test call could arm it.

Fork CI refuses it in production: `check-test-hooks.mjs` gets the markers `__FORK_TEST_SLOW_OPEN_MS__` and the runtime global it sets (`__forkTestSlowOpen`, set when the delay runs, so a bundle that kept the code is caught). The iPhone Release build phase (`check-release-page.sh`) uses the same script, so it is covered; the existing Release smoke exemption is unchanged. The iPhone UI test and the Mac tests bundle a page built with `FORK_TEST_HOOKS=true` and a slow open.

## Tests

- loot-core: the event is sent once after the open, not on a failed open, again on a reopen; the hook delays the open and is a no-op at 0.
- Page (`nativeBridge.test.ts`): `budget-opened` is forwarded as a notify event.
- `check-test-hooks.test.mjs`: the new markers are caught.
- Swift (`NativeBridgeCore` tests), for each of the three view models: failed then `budgetOpened()` reads once and ends loaded; loaded does not read; loading is superseded; a failed re-read stays failed after one read; background scene does not read. The shells' event routing: iPhone controllers and the Mac host pass `budget-opened` on.
- UI/integration (slow-open page): iPhone `SlowOpenUITests` drives the Budget screen at 10000 ms through a page death and shows Retry, then recovery with no tap; it shows the recovery sequence only, not that the signal caused it (a screen showing numbers ignores the signal and also re-reads on the open's change events). Causation is proved by the view-model unit tests and the Mac real/control pair in `HomeEconomicsMacTests/BudgetOpenedTests.swift` (the Budget view model ends loaded through `MacEngineHost`'s real event path with the signal wired, and stays failed with it not wired).

## Open questions

1. Should a loaded screen also re-read after a switch? Settled: left alone (D2).
2. Mac CI has no UI test target: the Mac proof is an XCTest in `HomeEconomicsMacTests` driving the real page. Settled: the Architect accepted it on PR 518.
