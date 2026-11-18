# Tasks

## 1. Storage barrier in loot-core (sc-5219)

- [ ] 1.1 Failing tests first, importing the installed `absurd-sql/dist/indexeddb-backend` module on `fake-indexeddb`:
  - writes settle on `complete`, and on `abort` and `error`;
  - the chain advances in order with values captured at flush time;
  - `lastStoredFlushAt` is the last stored write's flush time, and `quota` is set on a quota error;
  - the latch stops writes and raises `fallback-write-error` and `storage-failed`;
  - `whenPersisted` and `storageState`;
  - SharedArrayBuffer mode resolves at once (design D2, D12).
- [ ] 1.2 `yarn patch absurd-sql@0.0.54`: rewrite `Persistance.write` to settle on the transaction; capture values at flush time; the chain, the latch, `lastStoredFlushAt`, `quota`, `whenPersisted` and `storageState`; failures raise `onFallbackFailure`. Keep the MIT notice and a header naming sc-5219. Add the root `resolutions` entry. `yarn install --immutable` passes with the lock's patch hash (D1, D2)
- [ ] 1.3 `whenPersisted()` and `storageState()` in `platform/server/fs/index.ts` (fork-marked), and resolving versions in `index.electron.ts` and `index.api.ts` (D2, "Only the native shells wait for storage")
- [ ] 1.4 Failing tests first for `native/persisted` (stored, not stored on timeout, `[native:not-stored]`), `native/storage-state` and the limit with floor and ceiling. Then:
  - both handlers;
  - `not-stored` in `refusal.ts` and `native-refusal-codes.json`;
  - `native-persist-wait-ms` (default 2000, floor 100, ceiling 4000) and the registry's optional `floor` in `limits.ts` (D4, D7).
- [ ] 1.5 Failing tests first for "Only stored changes reach the server" (nothing sent before persistence; on a hung store, nothing sent after the wait and a retry next round; nothing sent or received with the latch set; no duplicate after re-entry). Then the fork-marked gate in `_fullSync` (D6)
- [ ] 1.6 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` tests; all pass

## 2. Page bridge (sc-5219)

- [ ] 2.1 Failing tests first in `nativeBridge.test.ts`: a write is refused before forwarding when `native/storage-state` reports the latch (set by any source); `storage-failed` is posted with `lastStoredFlushAt` and `quota`; `native/persisted` and `native/storage-state` are allowlisted, and the write call itself contains no wait (D3, D5)
- [ ] 2.2 The latch check, the `storage-failed` event in `EVENTS`, `native-bridge-allowlist.json`, the Swift allowlist and `coverage.json` skips
- [ ] 2.3 Test hooks behind `__FORK_TEST_HOOKS__` (false in production builds). A Fork CI step searches the production page and worker bundles for the hook marker and fails if found (D10)
- [ ] 2.4 Run `yarn typecheck`, `yarn lint` and the `@actual-app/web` tests; all pass

## 3. iPhone and Mac shells (sc-5219)

- [ ] 3.1 Failing Swift tests first:
  - the read/write table in `NativeBridgeClient` (every allowlisted name classified);
  - the two-call write returning `stored`, with only `native/persisted` retried;
  - "Saving…" until stored, and "Saved here, not yet stored on this device." on `stored: false`, cleared on `stored`;
  - the persistent app-level failure notice with `lastStoredFlushAt` and Reload, and the device-full variant (the Product Owner's four sentences), the time to the second and truncated, and the no-time sentence when nothing stored this session;
  - `[native:not-stored]` mapping;
  - copy-table keys, with the failure wording sent to the Product Owner for approval (D3, D5).
- [ ] 3.2 Lifecycle:
  - iPhone: the background task with an expiration handler, ended at the earliest of the answer, the wait or expiry.
  - Mac: `.terminateLater` on quit, a deferred window close, and a best-effort flush in `EngineLifecycle.willSleep`.
  - Tests with a fake client (D8).
- [ ] 3.3 Mac perf gate in `HomeEconomicsMacTests`: the end-to-end client write (`native/storage-state`, the write, `native/persisted`) against the bare write, 30 runs each, at most 50 ms added to the median and 250 ms to the p95, run in `fork-mac-native`. Record simulator timings in the PR, and a real iPhone's median and p95 before the native Accounts screen defaults on. If the gate misses, stop and report to the Director. Report any default below 2000 ms to the Product Owner (D7, D11)
- [ ] 3.4 Kill tests, in the Atlas helper login only:
  - Mac: extend `PageProcessKillTests` with 20 kills after `stored: true`, all kept and `PRAGMA integrity_check` passing, plus one kill mid-write.
  - Control run: barrier hook off and a 300 ms commit delay; it must lose at least 1, or it fails as inconclusive.
  - iPhone simulator: the same loop.
  - Put the before and after counts in the PR (D12).
- [ ] 3.5 Run the `NativeBridgeCore` tests, the Mac tests and the iOS build; all pass. The next TestFlight build carries this change (Product Owner, comment 5222)
