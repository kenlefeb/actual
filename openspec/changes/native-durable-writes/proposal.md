# Proposal

## Why

Story sc-5219. In the Mac app, a change made just before the page's process died was lost (twice). Killed 1 s or 5 s later, it was kept. The Architect's Explore (sc-5219 comment 5221) found the cause:
- loot-core stores budgets with `absurd-sql`.
- Both fork shells, the iPhone app (Capacitor) and the Mac app, run it in fallback mode, because WebKit gives a custom-scheme page no SharedArrayBuffer.
- In fallback mode, absurd-sql starts each IndexedDB write after SQLite commits and never waits for it.

So a native bridge write is acknowledged before it is stored, and a process kill in that gap loses it. A failed store only fires a `fallback-write-error` event after the write was acknowledged. This is upstream library behaviour; the fork's shells are what expose it.

The Product Owner's decision (comment 5222): Propose now, top of the native queue. The next TestFlight build after this ships carries it.

## What Changes

- **A durability barrier in the storage library.** `absurd-sql` 0.0.54 is carried with a fork-only yarn patch. Its fallback file keeps the chain of pending IndexedDB writes and exposes "when persisted". After the first failed write, it stops writing, so stored data stays at the last good commit.
- **A loot-core barrier handler.** `native/persisted` waits, up to a limit, for every pending write of the open budget. The answer is stored, not yet stored, or failed.
- **Native writes reply only once stored.** The page bridge awaits the barrier after every allowlisted write, before it replies to Swift.
  - Past the wait, the write still replies, and Swift shows "Saved here, not yet stored on this device." until a later "stored" event.
  - A failed store becomes a refusal with `[native:not-stored]`, and every later write is refused the same way until a reload.
- **A new limit.** `native-persist-wait-ms` (name "Saving: wait for device storage", default 2000, ceiling 30000) in the limits registry, shown in Settings > Advanced > Limits.
- **Best-effort flushes on lifecycle events.** The iPhone app flushes when it moves to the background, within a background task. The Mac app flushes when it quits, closes its window or goes to sleep. These are the only protection for edits made in the web screens inside the shells, which are not awaited one by one.

Mobile scope: the iPhone app and the Mac app, the two native shells. The web screens inside them get the lifecycle flushes only. The web app served by our server, Electron and MCP are not at risk and do not change (design D7).

Not in this change:
- offering the absurd-sql change upstream (a later, separate decision);
- the reload notice (sc-5220), which stays and is unchanged (design D9).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-bridge`: new requirements:
  - "Native writes reply once stored"
  - "A write past the storage wait says it is not yet stored"
  - "A failed store is refused and stops further writes"
  - "The storage wait is a limit"
  - "The shells flush storage before backgrounding or quitting"
  - "Only the native shells wait for storage"
  - "The barrier is measured and gated"
  - "An acknowledged write survives a page-process kill"

## Impact

- **Code:**
  - `.yarn/patches/absurd-sql-npm-0.0.54-*.patch` and its root `package.json` resolution;
  - `packages/loot-core/src/platform/server/fs/index.ts` (a fork-marked `whenPersisted` export, resolving at once on Electron and in the API);
  - `server/native/app.ts` (`native/persisted`), `refusal.ts` and `fixtures/native-refusal-codes.json` (`not-stored`), `limits.ts`;
  - `packages/desktop-client/src/native/nativeBridge.ts` (await after writes) and the allowlist (`native/persisted`);
  - Swift: the iPhone `AppDelegate` and bridge client; the Mac `EngineLifecycle`, `MacEngineHost` and app delegate; the copy table; tests.
- **Upstream files touched:** none of Actual's beyond the fork-marked `fs/index.ts` export. The patch is to a third-party package.
- **Reviews:** Tester; Solution Architect; Security Analyst (a patched dependency, a new allowlisted handler); the Product Owner reviews intent.

## Decisions for Ken

None.
