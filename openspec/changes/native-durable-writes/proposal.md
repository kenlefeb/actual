# Proposal

## Why

Story sc-5219. In the Mac app, a change made just before the page's process died was lost (twice). Killed 1 s or 5 s later, it was kept. The Architect's Explore (sc-5219 comment 5221) found the cause:
- loot-core stores budgets with `absurd-sql`.
- Both fork shells, the iPhone app (Capacitor) and the Mac app, run it in fallback mode, because WebKit gives a custom-scheme page no SharedArrayBuffer.
- In fallback mode, absurd-sql starts each IndexedDB write after SQLite commits and never waits for it.

So a native bridge write is acknowledged before it is stored, and a process kill in that gap loses it. A failed store only fires a `fallback-write-error` event after the write was acknowledged. This is upstream library behaviour; the fork's shells are what expose it.

The Product Owner's decision (comment 5222): Propose now, top of the native queue. The next TestFlight build after this ships carries it.

## What Changes

- **A durability barrier in the storage library.** `absurd-sql` 0.0.54 is carried with a fork-only yarn patch:
  - its fallback writes now settle on the transaction's `complete`, `abort` or `error`; today they never settle;
  - they are chained with values captured at flush time;
  - the library exposes "when persisted" and the storage state;
  - any failed write sets a latch that stops all further writes, so stored data stays at the last good commit.
- **A saved write is a stored write.** The Swift bridge client follows each write with a `native/persisted` call, which has its own deadline. It returns the write's result with `stored: true` or `stored: false`. Screens show a write as saved only when stored, and "Saving…" until then; past the wait they show "Still saving to this device. Keep the app open." A write is never retried because storage was slow.
- **Nothing applies after a storage failure, from any source.** The page bridge checks the latch before forwarding any write, and refuses with `[native:not-stored]`. A persistent app-level notice says changes made after the last stored time need to be made again, and offers Reload.
- **Only stored changes reach the server.** Sync waits for local storage before sending, and sends nothing after a failure. A refused change therefore can't come back as a duplicate.
- **A new limit.** `native-persist-wait-ms` ("Saving: wait for device storage", default 2000, floor 100, ceiling 4000, under the 5 s bridge deadline).
- **Best-effort lifecycle flushes:**
  - iPhone: on backgrounding, within a background task with an expiration handler;
  - Mac: on quit and window close, and best-effort on sleep.
- **Test hooks stay out of production.** A build-time constant removes them, and Fork CI checks the bundles.

Mobile scope: the iPhone app and the Mac app, the two native shells. The web screens inside them get the lifecycle flushes only. The web app served by our server, Electron and MCP are not at risk and do not change. A browser that falls back to the same storage mode keeps today's sync and messages; protecting it is story 5249 (design D7a).

Not in this change:
- offering the absurd-sql change upstream (a later, separate decision);
- the reload notice (sc-5220), which stays and is unchanged (design D9).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: "Sync failure reasons map to a closed set" is modified. New requirements:
  - "A write is saved only when storage says so"
  - "The storage barrier waits for complete"
  - "A not-yet-stored write belongs to its page load"
  - "The storage status line shows only saving states"
  - "A restart with unconfirmed writes tells the person"
  - "Offline never claims saved while a write is pending"
  - "Any storage failure latches and is shown app-wide"
  - "No write applies after a storage failure"
  - "Only stored changes reach the server"
  - "The failure notice says what was lost"
  - "The notice's cut-off time is exact"
  - "The restart notice asks the person to check"
  - "A restart keeps the device-full reason"
  - "The failure notice outranks the reload notice"
  - "The restart notice keeps the earliest cut-off"
  - "The storage wait is a limit"
  - "The shells flush storage before backgrounding or quitting"
  - "Durable platforms do not wait for storage"
  - "A held sync never reports success"
  - "The storage guard is for the native shells"
  - "A closed budget's failed write is reported"
  - "Limits report their floor"
  - "Test hooks are absent from production"
  - "The barrier is measured and gated"
  - "An acknowledged write survives a page-process kill"

- `mobile-sync-status`: new requirement "A held sync says it is waiting".

## Impact

- **Code:**
  - `.yarn/patches/absurd-sql-npm-0.0.54-*.patch` and its root `package.json` resolution;
  - `packages/loot-core/src/platform/server/fs/index.ts` (a fork-marked `whenPersisted` export, resolving at once on Electron and in the API);
  - `server/native/app.ts` (`native/persisted`, `native/storage-state`), `refusal.ts` and `fixtures/native-refusal-codes.json` (`not-stored`), `limits.ts` (the limit and an optional `floor`);
  - `server/sync/index.ts` (a fork-marked edit: send only after `whenPersisted`, and nothing after a failure);
  - `packages/desktop-client/src/native/nativeBridge.ts` (the latch check before writes, the `storage-failed` event) and the allowlist (`native/persisted`, `native/storage-state`);
  - Swift: `NativeBridgeClient` (the read/write table, the two-call write with `stored`); the iPhone `AppDelegate`; the Mac `EngineLifecycle`, `MacEngineHost` and app delegate; the app-level notice; the copy table; tests.
  - Fork CI: the production-bundle check for test hooks.
- **Upstream files touched:** fork-marked edits to `fs/index.ts` (exports) and `sync/index.ts` (the send gate, a no-op off the native shells). The patch is to a third-party package.
- **Reviews:** Tester; Solution Architect; Security Analyst (a patched dependency, a new allowlisted handler); the Product Owner reviews intent.

## Decisions for Ken

None.
