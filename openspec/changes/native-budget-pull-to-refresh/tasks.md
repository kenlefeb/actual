# Tasks

Test-first: write the tests, run them and see them fail before writing the code. One story, one PR. iOS native only; desktop and web are unchanged (see the proposal's Mobile scope). Needs sc-3859 (merged) and the native Budget screen (sc-3796).

## 1. Page bridge: allowlist `sync` and reduce its result (sc-3884)

- [ ] 1.1 Add failing vitest tests in `packages/desktop-client/src/native/`: `sync` is in `native-bridge-allowlist.json`; the page returns `{ok: true}` when `send('sync')` returns messages; each loot-core reason maps as in the spec (`network-failure`, `unauthorized`, `out-of-sync`, `clock-drift`, `encrypt-failure`, `decrypt-failure`, `invalid-schema`, an unknown one); an error whose `message` and `meta` hold a server URL and body yields only the reduced shape; arguments to `sync` are ignored or refused; `simplefin-batch-sync` and `accounts-bank-sync` are refused. Verify: they fail first.
- [ ] 1.2 Add `sync` to `native-bridge-allowlist.json` and the reduction in `nativeBridge.ts`, returning a shape the page builds itself. Verify: 1.1 passes and the existing allowlist-equality test still compares the two lists.
- [ ] 1.3 Add `sync` results to the contract fixtures (ok, and one per reason) with a vitest contract test. Verify: the test fails against a changed shape.

## 2. Swift client: the `sync` call and its deadline (sc-3884)

- [ ] 2.1 Add failing Swift tests in `NativeBridgeCore`: `sync` is in `NativeBridgeAllowlist.handlers` and equals the page list; `client.sync()` sends no arguments; `call("sync", args:)` with any argument is refused; a bank sync name is refused; the result decodes `ok`, each reason, and an unknown reason as `other`; a transport that never answers times out after 30 s for `sync` and after 5 s for `native/budget-month` (inject the deadline, do not sleep). Verify: they fail first.
- [ ] 2.2 Add a per-call deadline to `NativeBridgeClient` (default 5 s, `sync()` passes 30 s), the `SyncResult` and closed `SyncFailureReason` types, and `client.sync()`. Verify: 2.1 passes.
- [ ] 2.3 Extend `PageCallTests` and `PageOriginGuardTests`: a `sync` call from another frame, host, scheme or port is refused with the fixed origin error and reaches no page. Verify: they pass after 2.2, and `check-native-swift` is green.

## 3. Budget view model: refresh (sc-3884)

- [ ] 3.1 Add failing `BudgetViewModel` tests on a fake transport and the fixtures: `refresh()` on `ok` re-reads once and the numbers update; on each failure reason it keeps the numbers (`.stale`) and sets the fixed error; on a timeout it keeps the numbers, sets the timeout message, and does not re-read or retry; a second `refresh()` while one runs makes no second call; no `sync` and no read while the scene is inactive; `ok` followed by a failed re-read keeps the old numbers with `refreshFailed`; no bank sync name is ever called; a tracking fixture behaves the same; no total is computed from the sync result. Verify: they fail first.
- [ ] 3.2 Implement `refresh()` and `refreshError` over the existing generation-counted `load()` path. Verify: 3.1 passes.
- [ ] 3.3 Add a test that the late `sync-event` after a timeout re-reads through the `ChangeCoalescer` path. Verify: it passes without new code, or fails and is fixed.

## 4. SwiftUI Budget tab: the gesture and the message (sc-3884)

- [ ] 4.1 Add `refreshable` to the Budget tab's scroll view, awaiting `refresh()` so the system spinner ends when it returns, and an inline message view with the fixed strings per reason, the stale marking, and a VoiceOver announcement. Verify: in the Simulator against a seeded budget, a pull syncs and re-reads, and the message shows for an unreachable server.
- [ ] 4.2 Check the message at the largest accessibility size, in light and dark. Verify: it wraps, uses the semantic colours, and VoiceOver reads it.
- [ ] 4.3 Add a fork-news and release-note entry (user-facing): "Pull down on the Budget tab to sync" in `fork/release-notes/` and `actual-hosting/release-notes/` per AGENTS.md, with the version bump. Verify: `yarn generate:fork-news` leaves no diff and the release-note checks pass.

## 5. Device checks (sc-3884)

- [ ] 5.1 Write the repeatable device test as steps (second client, change, pull, expected result, timings) and Ken's self-contained checklist, which the Director arranges and the Checklist Reviewer reads. Verify: a reviewer who has not seen the code can follow it.
- [ ] 5.2 On Ken's iPhone from a TestFlight build against staging, check (a) the native Budget tab shows another device's change after a pull, and (b) the web Accounts and Budget screens' pull-to-refresh fires and syncs inside the web view. Verify: the evidence (steps, observed result, timings) is on the story.
- [ ] 5.3 If the web gesture fails in the web view, add a failing test and fix it there when small, or file a `bug` story. Do not add a second gesture. Verify: the test passes, or the story id is on sc-3884.
- [ ] 5.4 On archive, file nothing new: sc-3899 (bank sync on native Accounts) already exists, and polling is decided against in `design.md`.
