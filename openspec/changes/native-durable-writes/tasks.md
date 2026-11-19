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
- [x] 2.5 Failing test first: the bridge calls `native/enable-storage-guard` as it installs, before any budget opens. A failure from before the switch latches with a cut-off that can overstate the loss (Security, PR #473). **Not in the group 2 PR:** this lands in the group 3 PR that adds the failure notices (3.1), so no build carries the guard without them. Until then the page's latch check, event forwarding and allowlist entries are in place but nothing sets the latch

## 3. iPhone and Mac shells (sc-5219)

- [ ] 3.1 iPhone: failing Swift tests first:
  - the read/write table in `NativeBridgeClient` (every allowlisted name classified);
  - the two-call write returning `stored`, with only `native/persisted` retried;
  - "Saving…" until stored, and "Still saving to this device. Keep the app open." on `stored: false`, cleared on `stored`;
  - the persistent app-level failure notice with `lastStoredFlushAt` and Reload, and the device-full variant (the Product Owner's four sentences), the time to the second and truncated, and the no-time sentence when nothing stored this session;
  - the restart notice on iPhone and Mac: its copy with a time, with none and for a full device, OK, no Reload, repeated restarts, and a manual Reload showing no restart notice unless one is waiting for OK (D5a);
  - the failure notice replacing the reload notice at once, and no reload notice while it shows;
  - the held earliest cut-off: kept until OK, a later failure notice using its own cut-off, the restart notice returning on the next load, and a load time instead of "since you opened the app" after any reload;
  - `[native:not-stored]` mapping;
  - copy-table keys, with the failure wording sent to the Product Owner for approval (D3, D5).
- [x] 3.2 Lifecycle:
  - iPhone: the background task with an expiration handler, ended at the earliest of the answer, the wait or expiry.
  - Mac: `.terminateLater` on quit, a deferred window close, and a best-effort flush in `EngineLifecycle.willSleep`.
  - Tests with a fake client (D8).
  - The flush asks `native/persisted` with `allFiles: true`. The page bridge passes on only that: any other argument, or an `allFiles` that is not `true`, is dropped, so the call is the plain one.
- [ ] 3.3 Mac perf gate in `HomeEconomicsMacTests`: the end-to-end client write (`native/storage-state`, the write, `native/persisted`) against the bare write, 30 runs each, at most 50 ms added to the median and 250 ms to the p95, run in `fork-mac-native`. Record simulator timings in the PR and, before the first TestFlight build with this change, a real iPhone's median and p95 and the largest test budget's write time against the 60 s read deadline (raise the constant if it comes close). If the gate misses, stop and report to the Director. Report any default below 2000 ms to the Product Owner (D7, D11)
- [ ] 3.4 Kill tests, in the Atlas helper login only:
  - Mac: extend `PageProcessKillTests` with 20 kills after `stored: true`, all kept and `PRAGMA integrity_check` passing, plus one kill mid-write.
  - Control run: barrier hook off and a 300 ms commit delay; it must lose at least 1, or it fails as inconclusive.
  - iPhone simulator: the same loop.
  - Put the before and after counts in the PR (D12).
- [ ] 3.5 Run the `NativeBridgeCore` tests, the Mac tests and the iOS build; all pass. The next TestFlight build carries this change (Product Owner, comment 5222)
- [x] 3.6 Failing test first for "A not-yet-stored write belongs to its page load": `seq` carries the page load's epoch; Swift also records each write's page-load generation, for a write with no answer and so no `seq`; `stored: true` and `stored` clear only their own epoch; a restart turns older pending writes into "may not have been saved", and no later success clears them (D4)
- [ ] 3.9 Failing tests first, in the PR that adds the restart notice and turns the guard on: OK on the notice calls `acknowledgeMayNotBeSaved()`, so "may not have been saved" does not last the whole session (Product Owner, PR #485). The guard flip announces nothing for storage completion; that announcement is task 6.7
- [x] 3.10 The final group 3 PR opts the iPhone in and turns the guard on, together with the restart and failure notices and the sc-5303 "Saved" gating (group 7). It does not turn the storage line on; that is task 6.6, after sc-5297. It merges after the kill tests (3.4), so the flip is last. `yarn check:native-swift` is one-way: `WriteStorageLineRollout.isOnInRelease` true requires the guard on, and the guard may be on with the line off. It also checks that each shell's `StorageGuardRollout.isOn` and its bridge's guard call agree. While a shell's switch is off, `write`, `StoredWrite` and `message` behave as today (Architect, design D7a)
- [ ] 3.11 Mac part of 3.1 (sc-5344): a separate opt-in PR after PR #470 and the Mac notices, with the Mac's own evidence (the 3.4 kill test and the 3.3 perf gate on the Mac). It repeats 3.1's tests for the Mac, then sets the Mac's `StorageGuardRollout.isOn` ("The storage guard is turned on per shell")
- [x] 3.12 The notice strip from the iPhone reload notice gains a button slot and persistent notices: OK on the restart and closed-budget notices, which ends that notice only; Reload on the failure notice, with no Dismiss; no auto-hide, VoiceOver announcing each once ("Storage notices keep their button until used"). The slot can hold a notice waiting behind a showing one, which shows when that one ends. Failing tests first; the UX Designer reviews it before the guard-on PR
- [x] 3.7 **Gate:** do not turn the storage guard on in the iPhone app until sc-5247 (iPhone page-death reload) and the iPhone part of sc-5220 (reload notice) have merged. The PR that turns it on links both merged PRs (Product Owner, sc-5219 comment 5277; design D7a)
- [ ] 3.8 Failing tests first for "The storage status line shows only saving states", "A restart with unconfirmed writes tells the person" and "The native Accounts offline status is constant": the two line states, "Saving…" held 0.6 s without delaying a reply, the line clearing at a restart, the notice with OK in place of the reload notice, and the native Accounts offline status staying "Offline" through writes without moving the rows (D4)

## 4. Review decisions from the engine PR (sc-5219)

- [x] 4.1 Failing tests first, then the engine: a timed-out sync wait raises `storage-slow`, emits no success, sends nothing and schedules a retry; `storage-stored` follows a timed-out `native/persisted`; `storage-close-failed` fires once for a closed file and does not latch (D4, D6, D7a)
- [x] 4.2 The page bridge forwards `storage-stored` as `stored`; `storage-slow` and `storage-failed` join the sync reasons in the page and Swift
- [x] 4.3 The storage guard: a one-way engine switch, off by default and set when the native bridge installs. Tests that with it off a fallback-mode browser's sync, messages and `fallback-write-error` are as today (safety-check failures only, no `conflict` flag), that with it off the patched backend fails as stock does (no latch, no dropped queue, quota rejections unseen, `onFallbackFailure` only for the safety check), and that with it on the latch, refusal, gate and notices apply; on `storage-failed` the page asks `native/storage-state` (D7a)
- [x] 4.4 `floor` in `native/settings`, its fixture and Swift decoding, and `native/settings-save` refusing values outside floor to ceiling, with tests (D7). Bounding the native and web Limits screens moves to `native-settings-screen`, since those screens don't exist yet
- [ ] 4.5 The closed-budget notice in the shells, with the Product Owner's wording in the copy table; the restart notices' approved wording goes there too
- [x] 4.6 Failing tests first, then the status lines (`NativeAccountsViewController` and its Accounts sync state; `MobileSyncStatus.tsx`): "Waiting for this device to finish saving" on `storage-slow`, kept through held retries, and normal again when the wait clears
- [x] 4.7 The patch as specified in D2 and D7: rejection from `trans.onabort` only; a `Set` of files; the per-database queue with the guard on or off; the 60 s deadline covering only the wait for pending writes, with a test that a read slower than the deadline still opens; `initialFullSync` completing under `storage-slow`

## 5. Reconcile search field and the storage line (sc-5296)

- [x] 5.1 Failing UI or screenshot check first: on Reconcile step 2, with the line showing, the line and the search field's text are both fully readable and the field takes taps, in light, dark and at the largest text size ("The storage status line never covers what a person needs")

## 6. Storage line placement (sc-5383)

- [ ] 6.1 The last row of a sheet scrolls clear of the line: show it on the Categorize sheet, and fix it if it can't
- [ ] 6.2 A context menu opened from a row near the bottom has no item under the line: show it, and fix it if one is covered
- [ ] 6.3 One UI test: with the line showing, open a sheet and close it, and the line is back above the tab bar ("The storage status line keeps its place")
- [ ] 6.4 In a Release build with the switch on, repeat the placement screenshots for both storage line requirements, in light, dark and at the largest text size: tab bar, keyboard, sheets, context menu, alerts, the delete confirmation (which must hide the line) and Reconcile step 2. Include native Accounts offline: the status stays "Offline" and the rows do not move during a write. Check the Undo bar by comparing frames, not from a screenshot: its `maxY` is at or above the line's `minY`

## 6. Turning the storage line on in Release, continued (sc-5297)

- [ ] 6.5 VoiceOver on a real iPhone: rows stay reachable, the line can be read, and the announcement is heard once and not during an alert. This needs Ken's device, so `ready-for-human` goes on only once the build exists
- [ ] 6.6 Turn the line on in Release (`WriteStorageLineRollout.isOnInRelease`, PR #485's task 3.10) only after 5.1, 6.1 to 6.5 and the iPhone gate in task 3.7. The PR links them, and the UX Designer approves the Release placement. Turning the line on does not change the native Accounts offline status, which stays "Offline"
- [ ] 6.7 "Saved to this device." announced once when the not-stored state clears, only if that state was announced (line full, short or hidden), never during an alert; failing tests first ("The storage status line's VoiceOver announcements")
- [ ] 6.8 The keyboard rule ("The storage status line fits above the keyboard"), being built in PR #494. A unit test at the A ÷ 3 boundaries for full, short and hidden, with A measured from below a showing notice strip; checks on an iPhone 16e at the largest text size, including Reconcile step 1; VoiceOver unchanged across the switches

## 7. Saying "Saved" only once stored (sc-5303)

The stored answer only reaches screens once the storage guard is on; with the guard off, a failed write still answers stored. So this group lands as a commit inside the guard-on PR, or as a PR stacked directly under it, and the guard-on PR doesn't merge without it (Product Owner, sc-5303 comment 5331).

- [x] 7.1 Failing tests first for "Screens say "Saved" only once the write is stored" and "Budget and Reconcile wait for storage before "Saved"": Paychecks (`Saved "%@".`, `Saved %@. Undo is available.`), Budget's refresh-failure wording, the Reconcile alert (stored at once shows it; stored after step 2 opens shows nothing), Undo offered at once and labelled "Undo", and no "Saved" for a write that never stores
- [x] 7.2 Change Paychecks and Budget to show those messages only on `stored: true` or the `stored` event, and Reconcile to show its alert only if stored before step 2 opens (never late; UX Designer, PR #496), with no new copy

## 8. Page dialogs (sc-5399)

Lands before the iPhone guard flip (task 3.10), which links it (design D13).

- [x] 8.1 Failing tests first for "Page dialogs are handled by the shell": the answer rules (core), each dialog on a real page (Mac), and on iPhone an alert over a native screen, confirm OK and Cancel, a typed prompt, and a confirm nobody answers
- [x] 8.2 `PageDialogs` and `PageDialogDelegate` in NativeBridgeCore; the iPhone shows dialogs in its own window above the strip and the storage line, the Mac as a sheet
- [x] 8.4 Review changes, tests first: no time limit on screen and the page going away answers Cancel and dismisses (Designer, Architect); Capacitor's calls only from the app's own page, "Another page", the flood guard and the length bound (Security)
- [ ] 8.3 Screenshots for the Designer (light, dark, largest text; over a native screen, with the strip and the storage line showing) in `~/Library/Developer/HomeEconomicsSpike/page-dialogs-5399/`, and Security's review of the forwarding and the other-page title
