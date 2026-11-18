# Tasks

## 1. Storage barrier in loot-core (sc-5219)

- [ ] 1.1 Failing tests first for the patched `FileOpsFallback` (order kept, `whenPersisted` waits, the failed state stops writes and rejects) and the SharedArrayBuffer-mode `whenPersisted` (design D2, D11)
- [ ] 1.2 `yarn patch absurd-sql@0.0.54`: the pending chain, the failed state and `whenPersisted` in `dist/indexeddb-backend.js`, with the MIT notice kept and a header naming sc-5219; the root `resolutions` entry; a test that fails if the resolution is dropped (D1)
- [ ] 1.3 `whenPersisted()` in `platform/server/fs/index.ts` (fork-marked), and resolving stubs in `index.electron.ts` and `index.api.ts` (D2, D7)
- [ ] 1.4 Failing tests first for `native/persisted` (stored, not stored on timeout, `[native:not-stored]`) and the limit. Then the handler, `not-stored` in `refusal.ts` and `native-refusal-codes.json`, and `native-persist-wait-ms` in `limits.ts` (name, help, default 2000, ceiling 30000) (D4, D5, D6)
- [ ] 1.5 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` tests; all pass

## 2. Page bridge (sc-5219)

- [ ] 2.1 Failing tests first in `nativeBridge.test.ts`:
  - every allowlisted name is classified as read or write;
  - writes await `native/persisted` before replying, and reads don't;
  - the `not-stored-yet`, `stored` and `store-failed` events;
  - writes are refused before forwarding in the failed state.
- [ ] 2.2 The read/write table and the await in `createNativeBridge`; `native/persisted` in `native-bridge-allowlist.json` and the Swift allowlist; the `coverage.json` skip (D3, D4, D5)
- [ ] 2.3 Run `yarn typecheck`, `yarn lint` and the `@actual-app/web` tests; all pass

## 3. iPhone and Mac shells (sc-5219)

- [ ] 3.1 Failing Swift tests first for the notices ("Saved here, not yet stored on this device.", the failed-store text with Reload), the copy-table keys, `[native:not-stored]` mapping, and the lifecycle hooks with a fake bridge (D4, D5, D8)
- [ ] 3.2 iPhone: the background flush in `AppDelegate` with `beginBackgroundTask`. Mac: `.terminateLater` on quit, deferred window close, and the flush in `EngineLifecycle.willSleep` (D8)
- [ ] 3.3 Mac perf gate in `HomeEconomicsMacTests` (30 runs, at most 50 ms added to the median and 250 ms to the p95), run in `fork-mac-native`; the iPhone simulator and real-device timings recorded in the PR. If the gate misses, stop and report to the Director (D10)
- [ ] 3.4 Kill tests:
  - Mac: extend `PageProcessKillTests` in the Atlas helper login only, 20 kills with the barrier (all kept) and a control run without it (losses recorded).
  - iPhone simulator: the same loop.
  - Put the before and after counts in the PR (D11).
- [ ] 3.5 Run the `NativeBridgeCore` tests, the Mac tests and the iOS build; all pass. The next TestFlight build carries this change (Product Owner, comment 5222)
