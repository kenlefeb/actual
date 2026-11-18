# Design

## Context

Read on `development` at b160d4180, and in `absurd-sql` 0.0.54 (`dist/indexeddb-backend.js` and its base64 IndexedDB worker):

- `platform/server/fs/index.ts` mounts absurd-sql's `SQLiteFS` with `IndexedDBBackend` and passes a callback that sends `fallback-write-error`.
- **SharedArrayBuffer mode** (`FileOps`): when SQLite unlocks to NONE, the worker waits for the readwrite transaction's `oncomplete`. A commit is durable when it returns.
- **Fallback mode** (`FileOpsFallback`): `unlock()` and `writeBlocks()` call `flush()`, which calls `this.persistance.write(this.writeQueue, this.cachedFirstBlock, …)`, drops the returned promise, then replaces the queue and nulls `cachedFirstBlock`. `Persistance.write` opens the database, starts a readwrite transaction, reads block 0 for `isSafeToWrite`, puts the blocks, and then sets `trans.onsuccess = resolve` and `trans.onerror = reject`.
  - **Verified against the source** (and by the reviewing Architect with `fake-indexeddb`): an `IDBTransaction` never fires `success`, only `complete`, `abort` and `error`. So today's promise never resolves. It rejects only on an `error` event, or when the safety check fails (which also calls `onFallbackFailure`, the source of `fallback-write-error`).
  - **What that means today:** the transaction still commits on its own once its puts finish, so data is stored. But nothing can tell when, and quota or abort failures are silent. Awaiting the existing promise would hang forever, so the patch must rewrite `write`, not only chain it (D2).
  - Each flush is one readwrite transaction, so it commits or aborts as a whole (Security review, PR #467).
- Both fork shells force fallback mode through `SharedArrayBufferOverride` (`browser-preload/start.ts`; Mac sc-4942, `EngineSpikeTests`).
- Native writes reach loot-core through `createNativeBridge` in `packages/desktop-client/src/native/nativeBridge.ts`. Every allowlisted name goes through `call()`, which forwards it and returns JSON. Writes include upstream handlers (`budget/budget-amount`, `budget/transfer-*`, `paycheck-*`) and fork handlers (`native/*`). Swift's `NativeBridgeClient` gives every call a 5 s deadline.
- The Mac app has `PageProcessKillTests` (PR #466), which SIGKILLs WebContent processes started after the test. It is gated by an environment variable and run only in the Atlas helper login.

## Goals / Non-Goals

**Goals:** a native write that replies as saved is in IndexedDB; a failed store is never silent; edits in web screens inside the shells are flushed on backgrounding or quit; the rest of the product unchanged.

**Non-Goals:** awaiting each web-screen edit; making the shells cross-origin isolated (impossible on a custom scheme); offering the patch upstream; changing the reload notice (sc-5220).

## Decisions

### D0. Threat model

The change protects against the page's WebContent process dying: a kill, crash or jetsam on the Mac or iPhone. IndexedDB is served by a WebKit process that outlives the page, so a transaction that fired `complete` survives the page's death.

It does not protect against OS crash or power loss. That would need `durability: 'strict'` transactions, which WebKit may or may not honour; their cost is unmeasured. Strict durability is recorded as a follow-up for the Product Owner, not requested here.

### D1. Carrying the patch

`yarn patch absurd-sql@0.0.54` writes `.yarn/patches/absurd-sql-npm-0.0.54-<hash>.patch`. The root `package.json` `resolutions` points `absurd-sql` at it, as the repo already does for `vite-plugin-node-polyfills`. The patch edits `dist/indexeddb-backend.js`, the file loot-core loads; the base64 worker serves SharedArrayBuffer mode only and is untouched. It keeps the MIT notice (Copyright 2021 James Long), which allows modification and redistribution, and its header names sc-5219. If the apps ever list third-party notices, absurd-sql is marked there as modified.

Supply-chain and drift guards:
- **`yarn.lock` records the patch's hash, and Fork CI runs `yarn install --immutable`.** An edited patch file or a lock drift fails install.
- **A changed dependency range can make a `resolutions` patch silently stop applying.** So the real tripwire is behavioural: a loot-core test imports the installed `absurd-sql/dist/indexeddb-backend` module (never a copy), runs it on `fake-indexeddb`, and fails unless writes settle on `complete` and `whenPersisted` waits for them. A no-op patch fails on behaviour, not only on an export check (Architect, non-blocking 6; Security advisory).
- The only Actual file touched for this is a fork-marked export in `fs/index.ts`.

Alternative rejected: vendoring absurd-sql. It is larger to review and hides the diff.

### D2. The patch

`Persistance.write` is rewritten to settle on the transaction:
- resolve on `trans.oncomplete`;
- reject with `trans.error` on `trans.onabort` only. Every failure ends in `abort` or `complete`, and `error` fires first, and with `AbortError` for each request the abort cancels, which would hide a quota error;
- reject at once when the safety check fails (calling `onFallbackFailure` as today).

`FileOpsFallback.flush()` captures the queue, `cachedFirstBlock` and the lock state **at flush time** into constants, and only then queues the write. So writes keep their order and run with the values of their own flush, not later ones.

A **per-database queue** orders every fallback write, read, close and delete, with the guard on or off and across all files of that name. The chained write creates its transaction later than stock did, so without the queue a read or close could overtake it. The queue restores stock's ordering and adds no refusal. One difference remains: a read behind a write that never settles rejects after the deadline in D7, where stock would hang.

 Each write records the time it was flushed (captured), and a write that stores sets `lastStoredFlushAt` to its own flush time. That is when its contents were fixed, not when it completed, so a change made while it was in flight is never reported as saved (Security, final review).

With the storage guard on (D7a), on the first rejection:
- `this.failed` is set to the error. Later flushes drop their queue and write nothing, so IndexedDB stays at the last good commit.
- `onFallbackFailure` is called for every kind of failure, not only the safety check, so the new `storage-failed` (D5) fires for quota, abort and error too. `fallback-write-error` keeps its existing meaning, the safety check alone (D7a).

With the guard off, a rejection is only caught, so the chain carries on and the backend fails exactly as stock does: no latch, no dropped queue, quota failures unseen, and `onFallbackFailure` only for the safety check.

The patched module also adds:
- `whenPersisted()`, which returns the chain and rejects with `this.failed` if it is set;
- `storageState()`, which returns `{ failed, lastStoredFlushAt, quota }` at once, where `quota` is true when the failure was a `QuotaExceededError`.

`FileOps` (SharedArrayBuffer mode) gets both, resolving at once. `IndexedDBBackend` keeps its files in a `Set` in production too, so `fs/index.ts` can reach the open budget's file. It is not a map by name: `_copySqlFile` creates a second file with the open budget's name, which has its own pending writes and must not replace the real one. `fs/index.ts` exports `whenPersisted()` and `storageState()` across open `/blocked` files. `index.electron.ts` and `index.api.ts` export versions that resolve at once and never fail.

### D3. Who waits, and how the stored state reaches the screen

- **Native bridge writes.** `NativeBridgeClient` (Swift) classifies every allowlisted name as read or write in one table, and a test fails if any is unclassified. A write's client call makes two bridge calls: the write itself, with its 5 s deadline, and then `native/persisted`, with its own 5 s deadline.
  - It returns the write's result plus `stored: true` or `stored: false`. View models show a write as saved only on `stored: true` (or a later `stored` event). Until then they show it as "Saving…".
  - If the second call times out, `stored` is false. Only `native/persisted` is ever retried, because it is idempotent; the write is never retried (Architect, blocking 2).
  - A kill between the two calls leaves the screen showing "Saving…", never saved (Security, 1).
- **Web screens inside the shells** are optimistic and have no acknowledgement to delay. They get the lifecycle flushes (D8), the sync gate (D6) and the app-level failure notice (D5).
- **Sync applying server messages** is not awaited. Anything lost comes back on the next sync.

### D4. `native/persisted`

A fork loot-core handler, allowlisted in both lists as a call with no arguments, with a `coverage.json` skip. It races `whenPersisted()` against `native-persist-wait-ms`:
- `{ stored: true }` when every pending write fired `complete`;
- `{ stored: false }` on timeout. The engine keeps waiting and sends `storage-stored` when the writes covered by that call finish, and the page bridge forwards it to Swift as `stored`;
- `[native:not-stored]` when the latch is set.

Every answer and `storage-stored` carries `seq`: an epoch fixed for that page load, and a number that restarts with it. Numbers alone can't be compared across a restart, so a success from the new page could otherwise clear a write the old page lost. Swift tracks unconfirmed writes per page load. A write whose `native/persisted` call never answered before a restart has no `seq`, so Swift also records its own page-load generation for every write when it is made. A success clears only its own epoch, and a restart turns older pending writes into "may not have been saved", which only the restart notice covers (Architect, PR #482).

The status line is for transient saving states only (Product Owner and UX Designer, PR #485). It shows "Saving…" and "Still saving to this device. Keep the app open."; once shown, "Saving…" stays at least 0.6 s so it can't flash. That is display timing, not a limit, and no reply waits for it. "Some recent changes may not have been saved" is never in the line: a line takes no touches and could not be acknowledged, so it is a restart notice with OK. When no failure notice is showing, that notice takes the reload notice's place. On native Accounts the offline status is always "Offline" (Product Owner, PR #485). It is the list's first section header, so text that changed with each write would move the rows, and any promise about saving or syncing can be false.

Where the line sits (read from PR #485 at 38e817e39, with the UX Designer's approval). It has its own window at alert level and takes no touches, so it stays visible over sheets and the keyboard. While it shows, tab screens and presented sheets get its height as extra bottom safe area, which is what lifts the Undo bar and lets rows end above it. A 0.1 s follower re-places it as sheets and the tab bar change, and it hides when the key window presents a `UIAlertController`. Reserved space can't solve the two remaining cases: the system search field on Reconcile step 2 ignores the safe area, and a context menu is drawn by the system below the line's window. Those fixes, and whether the Categorize sheet needs one, are left to the developer.

Deadline arithmetic: the wait ceiling is 4000 ms (D7), so `native/persisted` answers within 4 s plus a page round trip, inside its own 5 s deadline. The write call itself no longer contains any wait.

### D5. The failed latch, from any source

- The latch lives in the patched storage (D2). Bridge writes, web-screen edits and sync applies all set it, because they all write the same file.
- **Before forwarding any write**, the page bridge asks `native/storage-state` (a fork handler, instant, allowlisted, no arguments) and, if the latch is set, refuses with `[native:not-stored]` without forwarding. So nothing more is applied in memory (Security, 2a). `native/undo` is a write and is refused the same way.
- There is one residual race: a write already forwarded when another source's write fails. That write gets `stored: false` from its `native/persisted` and is covered by D6, so it is nowhere but memory.
- On latching, the page posts `storage-failed { lastStoredFlushAt, quota }` to Swift (a new entry in the bridge's `EVENTS`). Swift shows a persistent app-level notice above every screen until the person reloads or, after a restart, taps OK (D5a). It is not a screen toast (Architect, blocking 3).
- Copy (copy table; decided by the Product Owner at approval, PR #467 comment 6981240882). `<time>` is `lastStoredFlushAt` in the person's locale to the second (for example 3:42:10 PM), truncated, never rounded up (Security's approval nit), so a change stored at 3:42:05 is never re-entered as a duplicate. The notice offers Reload.
  - General: "Changes can't be saved on this device right now. Reload the app. Changes made after <time> weren't saved and need to be made again."
  - Device full (`quota`): "This device is full, so changes can't be saved. Free up some space, then reload the app. Changes made after <time> weren't saved and need to be made again. Saved changes can't sync until there's space." Sync writes to local storage too, so it can't resume until there is space.
  - No write stored since the app opened (`lastStoredFlushAt` null): the sentence with <time> becomes "Changes made since you opened the app weren't saved and need to be made again." in both notices.
- Reads still show in-memory data until reload, and the notice says those changes are not kept (Architect, non-blocking 5). Writes whose replies were `stored: false` were already shown as "Saving…", never saved.

### D5a. The failure notice across a restart

Product Owner decisions, sc-5219 comment 5245 and PR #474. A restart clears the page's latch and `lastStoredFlushAt`, and "Reload the app" is then out of date. The new page can store again, so the restart notice can't say that everything after the cut-off is lost. It holds one earliest cut-off and asks the person to check. Tracking separate windows was considered and dropped as too hard to act on.

- **Detecting a restart:** a page load the person didn't ask for through Reload. The Mac app has `webViewWebContentProcessDidTerminate` in `MacEngineHost`. On iPhone, Capacitor's `WebViewDelegationHandler` reloads silently, so the shell must observe that reload.
- **Holding the cut-off:** a restart clears the engine's memory, including `quota`, so Swift keeps the earliest cut-off, and whether the latest failure was a quota failure, until OK on a restart notice. Further restarts leave the notice alone.
- **The two kinds of notice stay distinct.** The failure notice says changes are known lost, so it always uses its own failure's cut-off: an older one would call changes stored since then lost, and the person would re-enter them. The restart notice says "may not have been saved. Check them", so the earliest cut-off is safe there. If a failure arrives while a restart notice is waiting for OK, the failure notice shows, and the next page load brings the restart notice back with the earliest time.
- **"Since you opened the app" keeps the first-load rule, in one place.** The restart notice alone wouldn't need it, because "may not have been saved" stays true. The failure notice does: after any reload the page's `lastStoredFlushAt` starts null, and "weren't saved" would be false for changes stored earlier. So one rule produces the cut-off when a failure arrives: `lastStoredFlushAt`, else the latest page load's time, truncated, else none on the app's first load. The restart notice reuses that value.
- **Priority:** the failure notice replaces the sc-5220 reload notice at once, and no reload notice appears while it, or its restart form, is showing.

Copy-table wording (Product Owner, PR #474):

| Case | Text |
|---|---|
| Restart | The app restarted. Changes made after <A> may not have been saved. Check them, and make again any that are missing. |
| Restart, no cut-off | The app restarted. Changes made since you opened the app may not have been saved. Check them, and make again any that are missing. |
| Restart, unconfirmed writes, no failure notice | The app restarted. Some recent changes may not have been saved. Check them, and make again any that are missing. |
| Restart, device full | The app restarted, and this device is out of space. Free up some space. Changes made after <A> may not have been saved. Check them, and make again any that are missing. |

<A> is the time to the second, cut off, never rounded up.

### D6. Sync sends only stored changes

In upstream `server/sync/index.ts`, `_fullSync` gets a fork-marked edit that applies only with the storage guard on (D7a):
1. It reads the messages to send, as today.
2. It then awaits `whenPersisted()`, which covers every write committed before the read, for at most `native-persist-wait-ms`.
3. It sends only if that resolves. If the wait expires (a hung IndexedDB), it throws `SyncError('storage-slow')`: nothing is sent, the messages stay, `fullSync` emits an error rather than `success`, and a retry is scheduled after `FULL_SYNC_DELAY`. No new notice shows (Product Owner, PR #474). The existing status lines, native and narrow-layout web, read "Waiting for this device to finish saving" and return to normal when the wait clears. A held retry keeps that text rather than flickering through "Syncing…". Native code gets the reason through the closed set. During `initialFullSync`, `storage-slow` is not a download failure: the budget is fine, so it completes without an error, the retry stays scheduled, `sync.pending` stays true, and nothing claims synced. A hung store therefore delays sending, is never reported as synced, and never sends unstored changes (Architect, PR #473).

If the latch is set, it sends nothing and receives nothing until reload, and reports a sync error, `storage-failed`, that the shells show as the D5 notice.

So a change refused or not stored is on neither the device nor the server, and "need to be made again" cannot produce a duplicate (Security, 2b). Changes stored before the failure stay on the device and are sent after reload.

Without the guard (browsers, Electron and the API), sync is unchanged. This is the one behavioural edit to an upstream file; it is fork-marked and small.

### D7. The limit

`native-persist-wait-ms` goes in `server/native/limits.ts` with:
- name "Saving: wait for device storage";
- help "How long a change waits to be stored on this device before the app says it isn't yet";
- default 2000, a new optional `floor` of 100 (the registry's readers treat a value outside floor to ceiling as the default; other limits keep floor 1), ceiling 4000, `hasReader: true`.

**Named exception to the limits rule:** `FALLBACK_READ_DEADLINE_MS`, fixed at 60 seconds in the patch. Limits are stored in the budget being opened, so storage can't read one at that moment. It covers only the wait for pending writes ahead of a read, not the read itself, so a slow but healthy open still succeeds. On expiry the open fails rather than read past a stuck write, and a retry recovers. Story 5269 tracks a device-level setting to replace it.

The ceiling stays under the 5 s bridge deadline (D4). The floor avoids a meaningless "not yet stored" on every write (Security advisory). Any default below 2000 ms is reported to the Product Owner.

`native/settings` returns `floor` for every limit (1 unless the registry sets one), in its fixture and Swift decoding, and the Limits screens are bounded to floor through ceiling, so no screen offers a value the save refuses (Architect, PR #473).

### D7a. Other platforms, and closed budgets

- **Durable platforms** (SharedArrayBuffer mode, Electron, the API): `whenPersisted` resolves at once, so nothing changes.
- **The storage guard is native-only** (Security's review of PR #473, ruled by the Architect). Merging the engine alone must not change what anyone sees, and a latched browser would stop syncing with no honest notice. So the engine has a one-way switch, off by default. The native page bridge turns it on when it installs (group 2); nothing turns it off, and browsers have no bridge. **The iPhone app must not turn it on until sc-5247 (page-death reload) and the iPhone part of sc-5220 (reload notice) have merged:** a restart turns pending writes into "may not have been saved", and the iPhone would otherwise say nothing (Product Owner, sc-5219 comment 5277). The Mac is covered by PR #470. It also tells the patched backend to latch. While it is off there is no latch, write refusal, sync gate, `storage-slow` or storage notice, and the backend and sync behave as they do today. The per-database queue (D2) runs either way, because it is what keeps stock's ordering; the read deadline is the one visible difference. Stock absurd-sql already keeps a later commit off a failed one: memory's block 0 has moved on, so the next write under a lock fails `isSafeToWrite` (Architect, PR #474).
- **Fallback-mode browsers keep today's behaviour.** `fallback-write-error` keeps its one meaning: the safety check failed because another tab changed the file. There is no `conflict` flag and no browser storage notice. Protecting browsers is story 5249.
- **`storage-failed` is a prompt.** The event can come from a closed file or a copy, so with the guard on the page asks `native/storage-state` before it treats the open budget as failed.
- **Closed budgets (native shells):** `close()` flushes and then drops the handle, so the last write of a closed budget can fail with no open file to latch. It must not latch, because it says nothing about the budget now open. The engine sends `storage-close-failed` once, and the shells show the Product Owner's wording: "Some recent changes to the budget you closed weren't saved. Open it and make them again." The sync gate means those changes were not sent. If the failure notice is showing, it keeps priority and this notice follows.

### D8. Lifecycle flushes

- **iPhone:** `applicationDidEnterBackground` calls `beginBackgroundTask(expirationHandler:)`. The handler ends the task at once. The flush calls `native/persisted` and ends the task at the earliest of the answer, `native-persist-wait-ms` (at most 4 s) or expiry (Security, 4; Architect, blocking 2).
- **Mac:**
  - Quitting: `applicationShouldTerminate` returns `.terminateLater` and replies after the answer or the wait.
  - Closing the window: `windowShouldClose` defers the close the same way.
  - Sleeping: `EngineLifecycle.willSleep` calls `native/persisted` as a best effort; it cannot delay sleep.
- Each flush waits for every file's pending writes, not only the open budget's, so a just-closed budget's last write isn't left behind (Architect, PR #482).
- Page-process death, or a jetsam kill of a backgrounded iPhone app, gives no warning. Only writes already stored survive.

### D9. Interaction with sc-5220 and with undo

- **sc-5220's reload notice** stays as specified and true: web-screen edits and writes still "Saving…" can be lost on a sudden page death. The failure notice takes priority over it (D5a).
- **Undo:**
  - `native/undo` is a write: it follows the same two calls, and is refused in the failed state.
  - Undo tokens live in the in-memory stack, which a reload clears, so a lost write leaves no token to misuse.

### D10. Test hooks, and keeping them out of production

Two test-only hooks exist: one turning the barrier off in the Swift client and page bridge, and one delaying each commit by a set time in the patched storage, for the control run (D11). Both sit behind a build-time constant, `__FORK_TEST_HOOKS__`:
- the Vite define sets it `false` in production builds, so the code is removed;
- Swift's are behind `#if DEBUG` in the test-only target.

Fork CI, after the production web build, searches the built page and worker bundles for the hooks' marker string and fails if it is found. A Swift test checks that the release build has no hook symbol (Security, 3).

### D11. Measurement plan and gate

- **Mac (automated, CI):** an XCTest in `HomeEconomicsMacTests` times a one-row `native/transactions-categorize` through `NativeBridgeClient` end to end, 30 times: the `native/storage-state` check, the write and `native/persisted`. It times the bare write 30 times with the hook off. It fails when the three calls together add more than 50 ms to the median or 250 ms to the p95. It runs in `fork-mac-native`.
- **iPhone:** timings on the simulator, and on a real iPhone (model and iOS version recorded) before the first TestFlight build that carries this change (Architect, non-blocking 8). The native Accounts screen is already on by default, so that build is now the gate. The real-iPhone run also records how long the largest test budget's download write takes: one healthy write could approach the 60 s read deadline, and the constant is raised if it comes close (Security, PR #473). The Mac VM and the simulator are not representative of iPhone flash.
- **Stop and report:** if the gate misses, the developer stops and reports to the Director, and the gate is not loosened.

### D12. Test strategy

- **loot-core** (the real patched module, on `fake-indexeddb`):
  - writes settle on `complete`, and on `abort` with the transaction's error;
  - the chain advances in order with values captured at flush time;
  - the latch stops further writes, raises `storage-failed` (and `fallback-write-error` only when the safety check fails), and `whenPersisted` rejects;
  - SharedArrayBuffer mode resolves at once;
  - `native/persisted` answers stored, not stored on timeout (fake timers) and `[native:not-stored]`;
  - `native/storage-state`;
  - the limit with its floor and ceiling;
  - `_fullSync` sends nothing before persistence, gives up after the wait and retries next round, and sends nothing in the failed state;
  - `lastStoredFlushAt` is the flush time, not the completion time, and `quota` is set on a quota error.
- **Page bridge:** a write is refused before forwarding in the failed state, `storage-failed` is posted, and `native/persisted` and `native/storage-state` are allowlisted.
- **Swift:**
  - the read/write table (every name classified);
  - the two-call write with `stored`, and only `native/persisted` retried;
  - "Saving…" until stored;
  - the app-level notice and its copy key;
  - `[native:not-stored]` mapping;
  - the lifecycle hooks with a fake client: the expiration handler ends the task; `.terminateLater` replies.
- **Kill tests (Mac, extending `PageProcessKillTests`):** in the Atlas helper login only, as in PR #466, never in Ken's session.
  - **With the barrier:** 20 times, create a category, SIGKILL the page's WebContent process the moment the client returns `stored: true`, reload and read back. All 20 must be there, and `PRAGMA integrity_check` must pass.
  - **Mid-write:** one run kills during a large write, and the integrity check must still pass.
  - **Control:** the barrier hook off and a 300 ms commit delay. It must lose at least one, or the run is inconclusive and fails (Architect, non-blocking 7). Its loss count is the "before" the Product Owner asked for.
- **iPhone simulator kill test:** the same loop in the iOS test target, killing the simulator's WebContent process by pid (`_webProcessIdentifier` behind `responds(to:)`, in the test-only target).

## Risks / Trade-offs

- [Patched third-party code] → Small, version-pinned, visible in `.yarn/patches`, guarded by a test, reviewed by Security.
- [Each native write is slower by one more bridge call and its IndexedDB commit] → Measured and gated (D11); reads are unaffected.
- [Sync waits for local storage] → Only in the fallback shells, where it is milliseconds; elsewhere it resolves at once.
- [The failed state forces a reload] → Better than acknowledging changes that can never be stored. Server-synced changes come back after the reload.
- [Web-screen edits remain at risk on sudden death] → Lifecycle flushes narrow it; sc-5220's notice tells the person; moving those screens native (ongoing) removes it.

## Migration Plan

No data migration. The patch changes when writes are awaited, not what is written. Rolling back restores today's behaviour. The next TestFlight build carries it (Product Owner).
