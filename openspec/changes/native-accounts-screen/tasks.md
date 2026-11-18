# Tasks

Tests first: write the tests, see them fail, then write the code. One story per group, one PR per group, in order: group 1 blocks group 2, which blocks group 3.

## 1. Batched accounts reads and their perf gates (sc-4386)

- [x] 1.1 `native/accounts-list` in `server/native/accounts.ts` (design D1). Failing contract tests first on a seed with on-budget, off-budget and closed accounts, a paycheck clearing account and a transfer: balances and totals equal the web bindings' sums, net worth, `clearingFor`, the currency fields. Fixture `accounts-list.json`
- [x] 1.2 `native/account-register` (design D1, D2). Failing tests first: newest-first order equal to the web's; keyset paging covers every row once, including when a row is inserted between pages; the `accounts-register-page-size` preference (default 50, ceiling 200, bad values fall back) through `readLimit`; a forged or malformed cursor fails; search over 100 characters fails and `%`, `_` and `\` match literally; scopes; search over payee, category, notes and amount returning a split's parent; running balance only for `all` with no search and `show-balances-<id>` on; header and upcoming on the first page only; rows carry `transferAccount` and `transferReconciled`. Fixture `account-register.json`
- [x] 1.3 `accounts.perf.test.ts`: the list on 50 accounts; the register's first page and a page 10,000 rows deep on a 20,000-row account, with and without search; median under 50 ms; prints median and p95
- [x] 1.4 Allowlist both reads (Swift list and `native-bridge-allowlist.json`, tests that the lists are equal), `coverage.json` skips, and Swift decode tests for both fixtures in `NativeBridgeCore`
- [x] 1.5 `yarn typecheck`, `yarn lint`, the tests, `yarn check:mcp-coverage`, the perf suite and `openspec validate --all --strict`; Security reviews the allowlist additions

## 2. Writes, switch, overlay and view models (sc-4931)

- [x] 2.1 `native/transactions-categorize`, `native/transactions-delete`, `native/account-reopen` and `native/account-move` (design D3). Failing tests first: undo token required; one undo step through `native/undo`; another account's id fails the whole call; a closed account refused; split rows, off-budget rows and on-budget transfers refused for categorize; a reconciled row refused unless `confirmedReconciled === true` (`"true"` and `1` refused); a hidden or unknown category refused; `accounts-write-max-ids` (default 100, ceiling 500) counting children and transfer partners; a transfer delete removes its partner and refuses a reconciled partner without confirmation; reopen only a closed account; move only within one section; nothing changes on any refusal
- [x] 2.1a Undo conflict check (design D3a): the writes record the state they left; `native/undo` refuses and changes nothing when a touched row or account differs since. Failing tests first with an edit applied after the write, as a sync would
- [x] 2.2 Allowlist the four writes in both lists with `coverage.json` skips; a test that `account-reopen` and `transactions-batch-update` are refused natively
- [x] 2.3 `NativeScreen.accounts` (design D4): `NativeTab.accounts` in `nativeTabs`, reading on when unset, the script entry, and the toggle in `NativeScreens.tsx`. Failing tests first: unset is on, off is off, the toggle persists across a reload
  - Temporary (Director, 2026-11-17): the switch defaults to OFF in code, so web `/accounts` is unchanged until the screens exist; the default flip to on is task 3.8. Done in sc-4931: `.accounts` in `nativeTabs`, the script entry, the Settings toggle and the overlay host (2.4).
- [x] 2.4 The overlay on the Accounts container and the router (design D5). Failing `NativeBridgeCore` tests first for which paths show native (`/accounts`, `/accounts/<known id>`) and which stay web (`/accounts/all`, unknown ids, `/transactions/<id>`), and for back returning to the register
- [x] 2.4a `webAccountAction` chrome message (design D7a): the closed action set, an account id required and known for `account-settings` and `bank-sync`, origin-checked; the page opens the existing add-account, link-account, account-menu and bank-sync flows, and the overlay steps aside and re-reads on close. Failing tests first on both sides
  - Done: `WebAccountAction`, the app's `handOff`, the page's `webAccountAction`, and the page flows it opens (the add-account dialog for add and link, the bank sync page, and the account page with its menu open). The overlay steps aside while a sheet or the web editor hides the tab bar and is built again, re-reading, on return.
- [x] 2.5 `NativeReconcileBanner` renders only while the Accounts switch is off (design D8); failing test first
- [x] 2.6 `AccountsListViewModel` and `AccountRegisterViewModel` against a fake transport and the fixtures (design D6). Failing tests first: redacted first load; re-reads, errors and timeouts keep the last values; coalesced re-reads; paging appends and stops at a null cursor; search debounce and scope reset the pages; no reads in the background and one on return; pull-to-refresh runs one `sync`
- [ ] 2.7 Run the checks in 1.5; Security reviews the writes
- [x] 2.8 Ask the PO, through the Director, to extend sc-4877 so the Swift-minted nonce also covers `confirmedReconciled` on these writes (design D3, accepted risk until then)

## 3. SwiftUI Accounts list and register on iPhone (sc-3611)

- [ ] 3.1 The list (design D7): sections and totals, "All accounts" (web), detail lines, sync-status subtitle, pull to refresh, Edit mode reorder, Net worth footer, the + menu and empty-state hand-offs, empty and loading and sync-error states. Verify in the Simulator against Figma frames 26:38, 26:194, 39:1369, 39:1455 and 39:1583, light and dark
- [ ] 3.2 Closed accounts with Reopen in teal and a read-only register (frame 38:1544)
- [ ] 3.3 The register with `NativeTransactionRow` (frames 27:201, 27:373): header, Upcoming, date sections, paging on scroll, swipes with haptics, Categorize picker from `native/budget-month`, reconciled and transfer-partner confirmations, "Changed since — can't undo", the ••• menu (Reconcile; Account settings and Sync now as web hand-offs), tap opens the web editor
- [ ] 3.4 Search and scope chips (frame 38:1414): results footer, no-results text, Cancel
- [ ] 3.5 Reconcile entry (design D8): the list banner, ••• › Reconcile and the long-press present the existing flow; a UI test that each opens on the right account
- [ ] 3.6 Dynamic Type to AX5, VoiceOver labels and custom actions, Dark Mode, Reduce Motion, localization; UX Designer reviews against the frames; notes on the story
- [ ] 3.7 Fork news entry for the native Accounts screen; file Backlog stories for the follow-ups in design D7 (the "to review" count, per-account bank sync failure; native add and link account is sc-4949)
- [ ] 3.8 Flip the Accounts switch to on when unset (design D4): `NativeScreenSwitch.isAccountsNative`, the page's `isNativeScreenOn('accounts')` fallback and the Settings default; failing tests first. It lands with the screens in this group, never before

## Mac, deferred to the Mac app (sc-3629)

Not in this change's PRs. When the Mac app exists, sc-3629 builds the Accounts window on the same handlers: sidebar sections with balances, the register table with keyboard commands, the transaction inspector and closed accounts (Figma 28:313, 28:556 and the 41:* Mac frames), with the switch-off fallback to the web screens. At archive, these items move to sc-3629 as a Backlog note.

## Workflow follow-up

- Archive when sc-3611 merges. Then move each story's change link to the archive path, add the `spec:native-accounts-screen` label, and add the spec to epic 470's description.
