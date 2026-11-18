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
- reject with `trans.error` on `trans.onabort` and `trans.onerror`;
- reject at once when the safety check fails (calling `onFallbackFailure` as today).

`FileOpsFallback.flush()` captures the queue, `cachedFirstBlock` and the lock state **at flush time** into constants, and only then chains them: `this.pending = this.pending.then(() => persistance.write(queue, first, locked))`. So writes keep their order and run with the values of their own flush, not later ones. Every settled write records `lastStoredAt`.

On the first rejection:
- `this.failed` is set to the error. Later flushes drop their queue and write nothing, so IndexedDB stays at the last good commit.
- `onFallbackFailure` is called for every kind of failure, not only the safety check, so `fallback-write-error` and the new `storage-failed` (D5) fire for quota, abort and error too.

The patched module also adds:
- `whenPersisted()`, which returns the chain and rejects with `this.failed` if it is set;
- `storageState()`, which returns `{ failed, lastStoredAt }` at once.

`FileOps` (SharedArrayBuffer mode) gets both, resolving at once. `IndexedDBBackend` keeps its files by name in production too, so `fs/index.ts` can reach the open budget's file. `fs/index.ts` exports `whenPersisted()` and `storageState()` across open `/blocked` files. `index.electron.ts` and `index.api.ts` export versions that resolve at once and never fail.

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
- `{ stored: false }` on timeout. The page keeps waiting in the background and sends `stored` when the chain resolves;
- `[native:not-stored]` when the latch is set.

Deadline arithmetic: the wait ceiling is 4000 ms (D7), so `native/persisted` answers within 4 s plus a page round trip, inside its own 5 s deadline. The write call itself no longer contains any wait.

### D5. The failed latch, from any source

- The latch lives in the patched storage (D2). Bridge writes, web-screen edits and sync applies all set it, because they all write the same file.
- **Before forwarding any write**, the page bridge asks `native/storage-state` (a fork handler, instant, allowlisted, no arguments) and, if the latch is set, refuses with `[native:not-stored]` without forwarding. So nothing more is applied in memory (Security, 2a). `native/undo` is a write and is refused the same way.
- There is one residual race: a write already forwarded when another source's write fails. That write gets `stored: false` from its `native/persisted` and is covered by D6, so it is nowhere but memory.
- On latching, the page posts `storage-failed { lastStoredAt }` to Swift (a new entry in the bridge's `EVENTS`). Swift shows a persistent app-level notice above every screen until reload, not a screen toast (Architect, blocking 3).
- Copy (copy table, wording for the Product Owner to approve): "Changes can't be saved on this device right now. Reload the app. Changes made after <time> weren't saved and need to be made again." `<time>` is `lastStoredAt` in the person's locale. The notice offers Reload.
- Reads still show in-memory data until reload, and the notice says those changes are not kept (Architect, non-blocking 5). Writes whose replies were `stored: false` were already shown as "Saving…", never saved.

### D6. Sync sends only stored changes

In upstream `server/sync/index.ts`, `_fullSync` gets a fork-marked edit:
1. It reads the messages to send, as today.
2. It then awaits `whenPersisted()`, which covers every write committed before the read.
3. It sends only if that resolves.

If the latch is set, it sends nothing and receives nothing until reload, and reports a sync error, `storage-failed`, that the shells show as the D5 notice.

So a change refused or not stored is on neither the device nor the server, and "need to be made again" cannot produce a duplicate (Security, 2b). Changes stored before the failure stay on the device and are sent after reload.

On the web from our server, Electron and the API, `whenPersisted` resolves at once and never fails, so sync is unchanged there. This is the one behavioural edit to an upstream file; it is fork-marked and small.

### D7. The limit

`native-persist-wait-ms` goes in `server/native/limits.ts` with:
- name "Saving: wait for device storage";
- help "How long a change waits to be stored on this device before the app says it isn't yet";
- default 2000, a new optional `floor` of 100 (the registry's readers treat a value outside floor to ceiling as the default; other limits keep floor 1), ceiling 4000, `hasReader: true`.

The ceiling stays under the 5 s bridge deadline (D4). The floor avoids a meaningless "not yet stored" on every write (Security advisory). Any default below 2000 ms is reported to the Product Owner.

### D8. Lifecycle flushes

- **iPhone:** `applicationDidEnterBackground` calls `beginBackgroundTask(expirationHandler:)`. The handler ends the task at once. The flush calls `native/persisted` and ends the task at the earliest of the answer, `native-persist-wait-ms` (at most 4 s) or expiry (Security, 4; Architect, blocking 2).
- **Mac:**
  - Quitting: `applicationShouldTerminate` returns `.terminateLater` and replies after the answer or the wait.
  - Closing the window: `windowShouldClose` defers the close the same way.
  - Sleeping: `EngineLifecycle.willSleep` calls `native/persisted` as a best effort; it cannot delay sleep.
- Page-process death, or a jetsam kill of a backgrounded iPhone app, gives no warning. Only writes already stored survive.

### D9. Interaction with sc-5220 and with undo

- **sc-5220's reload notice** stays as specified and true: web-screen edits and writes still "Saving…" can be lost on a sudden page death.
- **Undo:**
  - `native/undo` is a write: it follows the same two calls, and is refused in the failed state.
  - Undo tokens live in the in-memory stack, which a reload clears, so a lost write leaves no token to misuse.

### D10. Test hooks, and keeping them out of production

Two test-only hooks exist: one turning the barrier off in the Swift client and page bridge, and one delaying each commit by a set time in the patched storage, for the control run (D11). Both sit behind a build-time constant, `__FORK_TEST_HOOKS__`:
- the Vite define sets it `false` in production builds, so the code is removed;
- Swift's are behind `#if DEBUG` in the test-only target.

Fork CI, after the production web build, searches the built page and worker bundles for the hooks' marker string and fails if it is found. A Swift test checks that the release build has no hook symbol (Security, 3).

### D11. Measurement plan and gate

- **Mac (automated, CI):** an XCTest in `HomeEconomicsMacTests` times a one-row `native/transactions-categorize` through `NativeBridgeClient` 30 times with the barrier, and 30 times with the hook off. It fails when the barrier adds more than 50 ms to the median or 250 ms to the p95. It runs in `fork-mac-native`.
- **iPhone:** timings on the simulator, and on a real iPhone (model and iOS version recorded) before the native Accounts screen defaults on (Architect, non-blocking 8). The Mac VM and the simulator are not representative of iPhone flash.
- **Stop and report:** if the gate misses, the developer stops and reports to the Director, and the gate is not loosened.

### D12. Test strategy

- **loot-core** (the real patched module, on `fake-indexeddb`):
  - writes settle on `complete`, and on `abort` and `error` with the error;
  - the chain advances in order with values captured at flush time;
  - the latch stops further writes, raises `fallback-write-error` and `storage-failed`, and `whenPersisted` rejects;
  - SharedArrayBuffer mode resolves at once;
  - `native/persisted` answers stored, not stored on timeout (fake timers) and `[native:not-stored]`;
  - `native/storage-state`;
  - the limit with its floor and ceiling;
  - `_fullSync` sends nothing before persistence and nothing in the failed state.
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
