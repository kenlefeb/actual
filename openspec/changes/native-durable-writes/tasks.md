# Tasks

## 1. Storage barrier in loot-core (sc-5219)

- [x] 1.1 Failing tests first, importing the installed `absurd-sql/dist/indexeddb-backend` module on `fake-indexeddb`:
  - writes settle on `complete`, and on `abort` and `error`;
  - the chain advances in order with values captured at flush time;
  - `lastStoredFlushAt` is the last stored write's flush time, and `quota` is set on a quota error;
  - the latch stops writes and raises `storage-failed` (`fallback-write-error` only when the safety check fails);
  - `whenPersisted` and `storageState`;
  - SharedArrayBuffer mode resolves at once (design D2, D12).
- [x] 1.2 `yarn patch absurd-sql@0.0.54`: rewrite `Persistance.write` to settle on the transaction; capture values at flush time; the chain, the latch, `lastStoredFlushAt`, `quota`, `whenPersisted` and `storageState`; failures raise `onFallbackFailure`. Keep the MIT notice and a header naming sc-5219. Add the root `resolutions` entry. `yarn install --immutable` passes with the lock's patch hash (D1, D2)
- [x] 1.3 `whenPersisted()` and `storageState()` in `platform/server/fs/index.ts` (fork-marked), and resolving versions in `index.electron.ts` and `index.api.ts` (D2, "Durable platforms do not wait for storage")
- [x] 1.4 Failing tests first for `native/persisted` (stored, not stored on timeout, `[native:not-stored]`), `native/storage-state` and the limit with floor and ceiling. Then:
  - both handlers;
  - `not-stored` in `refusal.ts` and `native-refusal-codes.json`;
  - `native-persist-wait-ms` (default 2000, floor 100, ceiling 4000) and the registry's optional `floor` in `limits.ts` (D4, D7).
- [x] 1.5 Failing tests first for "Only stored changes reach the server" (nothing sent before persistence; on a hung store, nothing sent after the wait and a retry next round; nothing sent or received with the latch set; no duplicate after re-entry). Then the fork-marked gate in `_fullSync` (D6)
- [x] 1.6 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` tests; all pass

## 2. Page bridge (sc-5219)

- [x] 2.1 Failing tests first in `nativeBridge.test.ts`: a write is refused before forwarding when `native/storage-state` reports the latch (set by any source); `storage-failed` is posted with `lastStoredFlushAt` and `quota`; `native/persisted` and `native/storage-state` are allowlisted, and the write call itself contains no wait (D3, D5)
- [x] 2.2 The latch check, the `storage-failed` event in `EVENTS`, `native-bridge-allowlist.json`, the Swift allowlist and `coverage.json` skips
- [x] 2.3 Test hooks behind `__FORK_TEST_HOOKS__` (false in production builds). A Fork CI step searches the production page and worker bundles for the hook marker and fails if found (D10)
- [x] 2.4 Run `yarn typecheck`, `yarn lint` and the `@actual-app/web` tests; all pass
- [ ] 2.5 Failing test first: the bridge calls `native/enable-storage-guard` as it installs, before any budget opens. A failure from before the switch latches with a cut-off that can overstate the loss (Security, PR #473). **Not in the group 2 PR:** this lands in the group 3 PR that adds the failure notices (3.1), so no build carries the guard without them. Until then the page's latch check, event forwarding and allowlist entries are in place but nothing sets the latch

## 3. iPhone and Mac shells (sc-5219)

- [ ] 3.1 Failing Swift tests first:
  - the read/write table in `NativeBridgeClient` (every allowlisted name classified);
  - the two-call write returning `stored`, with only `native/persisted` retried;
  - "Saving…" until stored, and "Saved here, not yet stored on this device." on `stored: false`, cleared on `stored`;
  - the persistent app-level failure notice with `lastStoredFlushAt` and Reload, and the device-full variant (the Product Owner's four sentences), the time to the second and truncated, and the no-time sentence when nothing stored this session;
  - the restart notice on iPhone and Mac: its copy with a time, with none and for a full device, OK, no Reload, repeated restarts, and a manual Reload showing no restart notice unless one is waiting for OK (D5a);
  - the failure notice replacing the reload notice at once, and no reload notice while it shows;
  - the held earliest cut-off: kept until OK, a later failure notice using its own cut-off, the restart notice returning on the next load, and a load time instead of "since you opened the app" after any reload;
  - `[native:not-stored]` mapping;
  - copy-table keys, with the failure wording sent to the Product Owner for approval (D3, D5).
- [ ] 3.2 Lifecycle:
  - iPhone: the background task with an expiration handler, ended at the earliest of the answer, the wait or expiry.
  - Mac: `.terminateLater` on quit, a deferred window close, and a best-effort flush in `EngineLifecycle.willSleep`.
  - Tests with a fake client (D8).
- [ ] 3.3 Mac perf gate in `HomeEconomicsMacTests`: the end-to-end client write (`native/storage-state`, the write, `native/persisted`) against the bare write, 30 runs each, at most 50 ms added to the median and 250 ms to the p95, run in `fork-mac-native`. Record simulator timings in the PR and, before the first TestFlight build with this change, a real iPhone's median and p95 and the largest test budget's write time against the 60 s read deadline (raise the constant if it comes close). If the gate misses, stop and report to the Director. Report any default below 2000 ms to the Product Owner (D7, D11)
- [ ] 3.4 Kill tests, in the Atlas helper login only:
  - Mac: extend `PageProcessKillTests` with 20 kills after `stored: true`, all kept and `PRAGMA integrity_check` passing, plus one kill mid-write.
  - Control run: barrier hook off and a 300 ms commit delay; it must lose at least 1, or it fails as inconclusive.
  - iPhone simulator: the same loop.
  - Put the before and after counts in the PR (D12).
- [ ] 3.5 Run the `NativeBridgeCore` tests, the Mac tests and the iOS build; all pass. The next TestFlight build carries this change (Product Owner, comment 5222)
- [x] 3.6 Failing test first for "A not-yet-stored write belongs to its page load": `seq` carries the page load's epoch; Swift also records each write's page-load generation, for a write with no answer and so no `seq`; `stored: true` and `stored` clear only their own epoch; a restart turns older pending writes into "may not have been saved", and no later success clears them (D4)
- [ ] 3.8 Failing test first, in the PR that adds the restart notice and before the guard turns on: OK on the restart notice calls `acknowledgeMayNotBeSaved()`, so "may not have been saved" does not last the whole session (Product Owner, PR #485)
- [ ] 3.7 **Gate:** do not turn the storage guard on in the iPhone app until sc-5247 (iPhone page-death reload) and the iPhone part of sc-5220 (reload notice) have merged. The PR that turns it on links both merged PRs (Product Owner, sc-5219 comment 5277; design D7a)

## 4. Review decisions from the engine PR (sc-5219)

- [x] 4.1 Failing tests first, then the engine: a timed-out sync wait raises `storage-slow`, emits no success, sends nothing and schedules a retry; `storage-stored` follows a timed-out `native/persisted`; `storage-close-failed` fires once for a closed file and does not latch (D4, D6, D7a)
- [x] 4.2 The page bridge forwards `storage-stored` as `stored`; `storage-slow` and `storage-failed` join the sync reasons in the page and Swift
- [ ] 4.3 The storage guard: a one-way engine switch, off by default and set when the native bridge installs. Tests that with it off a fallback-mode browser's sync, messages and `fallback-write-error` are as today (safety-check failures only, no `conflict` flag), that with it off the patched backend fails as stock does (no latch, no dropped queue, quota rejections unseen, `onFallbackFailure` only for the safety check), and that with it on the latch, refusal, gate and notices apply; on `storage-failed` the page asks `native/storage-state` (D7a)
- [ ] 4.4 `floor` in `native/settings`, its fixture and Swift decoding; the native and web Limits screens bounded to floor through ceiling (D7)
- [ ] 4.5 The closed-budget notice in the shells, with the Product Owner's wording in the copy table; the restart notices' approved wording goes there too
- [x] 4.6 Failing tests first, then the status lines (`NativeAccountsViewController` and its Accounts sync state; `MobileSyncStatus.tsx`): "Waiting for this device to finish saving" on `storage-slow`, kept through held retries, and normal again when the wait clears
- [x] 4.7 The patch as specified in D2 and D7: rejection from `trans.onabort` only; a `Set` of files; the per-database queue with the guard on or off; the 60 s deadline covering only the wait for pending writes, with a test that a read slower than the deadline still opens; `initialFullSync` completing under `storage-slow`
