# Design

## Context

Read on `development` at b160d4180, and in `absurd-sql` 0.0.54 (`dist/indexeddb-backend.js` and its base64 IndexedDB worker):

- `platform/server/fs/index.ts` mounts absurd-sql's `SQLiteFS` with `IndexedDBBackend` and passes a callback that sends `fallback-write-error`.
- **SharedArrayBuffer mode** (`FileOps`): when SQLite unlocks to NONE, the worker waits for the readwrite transaction's `oncomplete`. A commit is durable when it returns.
- **Fallback mode** (`FileOpsFallback`): `unlock()` and `writeBlocks()` call `flush()`, which calls `this.persistance.write(queue, …)` and drops the returned promise. `Persistance.write` opens the database, starts a readwrite transaction, reads block 0 for `isSafeToWrite`, puts the blocks and resolves on success. A failed safety check calls `onFallbackFailure` once and rejects, and nothing listens to the rejection. Other errors (quota, abort) reject unseen.
- Both fork shells force fallback mode through `SharedArrayBufferOverride` (`browser-preload/start.ts`; Mac sc-4942, `EngineSpikeTests`).
- Native writes reach loot-core through `createNativeBridge` in `packages/desktop-client/src/native/nativeBridge.ts`. Every allowlisted name goes through `call()`, which forwards it and returns JSON. Writes include upstream handlers (`budget/budget-amount`, `budget/transfer-*`, `paycheck-*`) and fork handlers (`native/*`).
- The Mac app has `PageProcessKillTests` (PR #466), which SIGKILLs WebContent processes started after the test. It is gated by an environment variable and run only in the Atlas helper login.

## Goals / Non-Goals

**Goals:** a native write that replies as saved is in IndexedDB; a failed store is never silent; edits in web screens inside the shells are flushed on backgrounding or quit; the rest of the product unchanged.

**Non-Goals:** awaiting each web-screen edit; making the shells cross-origin isolated (impossible on a custom scheme); offering the patch upstream; changing the reload notice (sc-5220).

## Decisions

### D1. Carrying the patch

`yarn patch absurd-sql@0.0.54` writes `.yarn/patches/absurd-sql-npm-0.0.54-<hash>.patch`. The root `package.json` `resolutions` points `absurd-sql` at `patch:absurd-sql@npm%3A0.0.54#~/.yarn/patches/…`, as the repo already does for `vite-plugin-node-polyfills`. The patch edits `dist/indexeddb-backend.js`, the file the package exports and loot-core loads. It does not touch the base64 worker, which serves SharedArrayBuffer mode only. It keeps the file's MIT notice (Copyright 2021 James Long), which allows modifying and redistributing it; the patch header names sc-5219.

Surviving merges:
- The patch is keyed to version 0.0.54. If upstream Actual ever bumps absurd-sql (unmaintained since 2021), `yarn install` fails to apply the patch, which is a loud tripwire, not a silent loss.
- A loot-core test asserts that the backend file exposes `whenPersisted`, so a resolution dropped in a merge fails CI.
- The only Actual file touched is a fork-marked export in `fs/index.ts`.

Alternative rejected: vendoring a copy of absurd-sql. It is larger to review, and it hides the diff that the patch keeps visible.

### D2. The patch's barrier

In `FileOpsFallback`:
- `this.pending` is a promise chain. `flush()` sets `this.pending = this.pending.then(() => this.persistance.write(…))`, so writes keep their order and every rejection is caught on the chain.
- On the first rejection, `this.failed` is set to the error. From then on, `flush()` drops its queue and writes nothing, so IndexedDB stays at the last good commit and never receives a later write's pages without an earlier one's.
- `whenPersisted()` returns `this.pending`, rejecting with `this.failed` if set.

`FileOps` (SharedArrayBuffer mode) gets a `whenPersisted()` that resolves at once. `IndexedDBBackend` keeps its files by name, so `whenPersisted(filename)` can find the open budget's file in production too (today it does that only outside production builds).

`fs/index.ts` exports `whenPersisted()` for every open `/blocked` database file, from all open files' barriers. `index.electron.ts` and `index.api.ts` export one that resolves at once.

### D3. Who waits

- **Native bridge writes are awaited.** `createNativeBridge` classifies every allowlisted name as read or write in one table, and a test fails if any name is unclassified. After `forward(name, args)` for a write, it calls `forward('native/persisted')` before replying. `native/undo`, the reconcile writes, the paycheck writes, the budget writes, the account writes and `native/transaction-save` all count as writes; `sync` does not. This adds one page-to-worker round trip per write and changes no upstream handler.
- **Edits in the web screens inside the shells are not awaited one by one.** They have no acknowledgement to delay: the web UI is optimistic. They get the lifecycle flushes (D8). An edit made seconds before a sudden page-process death can still be lost, which is why sc-5220's notice stays (D9).
- **Writes that are not the person's** (sync applying server messages) are not awaited. They come back from the server on the next sync if lost.

### D4. `native/persisted`

`native/persisted` is a fork loot-core handler, allowlisted in the Swift list and the page's list, with a `coverage.json` skip, and it takes no arguments. It races `whenPersisted()` against `native-persist-wait-ms` (D6) and returns:
- `{ stored: true }` when every pending write has finished;
- `{ stored: false }` on timeout; the write keeps going;
- a rejection `[native:not-stored]` when a write failed (D5).

On `stored: false`, the bridge replies with the write's result as usual and posts a `not-stored-yet` event to Swift. It keeps waiting in the background, with no limit, and posts `stored` when the chain resolves, or `store-failed` if it rejects. Swift shows "Saved here, not yet stored on this device." (copy table) until `stored`. A timeout never fails the write, so Swift never retries it and never applies it twice.

### D5. Failed stores

- When the barrier rejects, the write that was just made replies with `[native:not-stored]` (new code in `refusal.ts` and `native-refusal-codes.json`).
- The page bridge then refuses every later write **before forwarding it** (it asks `native/persisted` first while the failed flag is set), so nothing more is applied in memory that can never be stored.
- Swift shows "Changes can't be stored on this device right now. Reload the app; recent changes may need to be made again." (copy table) and offers Reload.
- The existing `fallback-write-error` event still fires for web screens.
- Changes that reached the sync server before the failure come back on the next sync after reload.

Slow IndexedDB: the not-yet-stored path (D4). Full IndexedDB: a quota error is a failed store (D5).

### D6. The limit

`native-persist-wait-ms` goes in `server/native/limits.ts` with:
- name "Saving: wait for device storage";
- help "How long a change waits to be stored on this device before the app says it isn't yet";
- default 2000, ceiling 30000, `hasReader: true`.

Settings > Advanced > Limits lists it, and the MCP settings tools see it as they see every limit. The default is provisional until D10's measurements; any change to it is reported to the Product Owner.

### D7. Unaffected shells

- **The web app from our server** is cross-origin isolated, so absurd-sql runs in SharedArrayBuffer mode and its `whenPersisted` resolves at once. It has no native bridge, so nothing calls the barrier.
- **Electron and the API** (so MCP) use better-sqlite3 through `index.electron.ts` and `index.api.ts`, whose `whenPersisted` resolves at once, and nothing calls it.
- **A browser served without isolation** keeps today's upstream behaviour (fallback mode, unawaited). It is not a fork shell, and it is out of scope.

### D8. Lifecycle flushes

- **iPhone:** `applicationDidEnterBackground` (and the scene equivalent if the app adopts scenes) calls `beginBackgroundTask`, then `__actualNativeBridge.call('native/persisted')`, and ends the task on the answer or after `native-persist-wait-ms` plus 1 s. iOS suspends the process afterwards.
- **Mac:**
  - Quitting: `applicationShouldTerminate` returns `.terminateLater` and replies after the barrier answers or the wait passes.
  - Closing the window: `windowShouldClose` defers the close the same way.
  - Sleeping: `EngineLifecycle.willSleep` calls the barrier before its existing sleep handling.
- **Page-process death on the Mac, or a jetsam kill of a backgrounded iPhone app, gives no warning.** Only writes already stored survive it. That is the bridge-write guarantee of D3, plus whatever the last flush stored.

### D9. Interaction with sc-5220 and with undo

- **sc-5220** (a notice on each automatic Mac reload) stays as specified. Bridge writes that replied as stored will survive, but web-screen edits and writes still "not yet stored" can be lost by a sudden page death, so the notice's wording ("a change you made in the last moment may need to be made again") stays true. Narrowing it to show only when something might be lost is not attempted; the page that knew is the one that died.
- **Undo:**
  - `native/undo` is a write, so it is awaited like any other.
  - An undo token belongs to the in-memory undo stack, which a reload clears. A write lost to a kill therefore has no token left to misuse.
  - Under D5's failed state, undo is refused with every other write, so an undo cannot apply in memory something that can never be stored.

### D10. Measurement plan and gate

- **Mac (automated, CI):** an XCTest in `HomeEconomicsMacTests` opens the test budget in the real `WKWebView` engine. It times a one-row `native/transactions-categorize` through the bridge 30 times with the barrier, and 30 times calling the handler without it (a test-only switch in the page bridge, compiled out of production). It prints medians and p95s, and fails when the barrier adds more than 50 ms to the median or 250 ms to the p95. It runs in `fork-mac-native`.
- **iPhone (manual, recorded):** the same timing on the simulator and on a real iPhone running a TestFlight-equivalent build, recorded in the PR with device model and iOS version.
- **Stop and report:** if the gate misses, the developer stops and reports the numbers to the Director; the gate is not loosened.

### D11. Test strategy

- **loot-core unit tests** run the patched `FileOpsFallback` with a fake `Persistance`:
  - writes keep their order;
  - `whenPersisted` waits for all of them;
  - a rejection sets the failed state, later flushes write nothing, and `whenPersisted` rejects;
  - SharedArrayBuffer mode resolves at once;
  - `native/persisted` answers stored, not stored on timeout (with fake timers) and `[native:not-stored]`;
  - `native-persist-wait-ms` behaves as a limit.
- **Page bridge tests:** every allowlisted name is classified; a write awaits `native/persisted` before replying; a read does not; `not-yet-stored`, `stored` and `store-failed` events are sent; writes are refused before forwarding in the failed state.
- **Swift tests:** the notices, the copy-table keys, `[native:not-stored]` mapping, and the lifecycle hooks with a fake bridge (background task ends on answer or timeout; `.terminateLater` replies).
- **The kill test that matters (Mac, extending `PageProcessKillTests`):** in the Atlas helper login, with its own bundle id and unsandboxed, as in PR #466, never in Ken's session.
  - Twenty times: create a category through the bridge, SIGKILL the page's WebContent process the moment the reply arrives, let `webViewWebContentProcessDidTerminate` reload, and read the categories back.
  - With the barrier, all 20 must be there.
  - A control run with the barrier switched off (test-only switch) records how many are lost, for the before and after the Product Owner asked for.
- **iPhone simulator kill test:** the same loop in the iOS test target, killing the simulator's WebContent process by pid (found with `_webProcessIdentifier` behind `responds(to:)`, test-only). Results go in the PR.

## Risks / Trade-offs

- [Patched third-party code] → Small, version-pinned, visible in `.yarn/patches`, guarded by a test, reviewed by Security.
- [Each native write is slower by its IndexedDB commit] → Measured and gated (D10); reads are unaffected.
- [The failed state forces a reload] → Better than acknowledging changes that can never be stored. Server-synced changes come back after the reload.
- [Web-screen edits remain at risk on sudden death] → Lifecycle flushes narrow it; sc-5220's notice tells the person; moving those screens native (ongoing) removes it.

## Migration Plan

No data migration. The patch changes when writes are awaited, not what is written. Rolling back restores today's behaviour. The next TestFlight build carries it (Product Owner).
