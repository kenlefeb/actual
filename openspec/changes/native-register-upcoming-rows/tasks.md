# Tasks

Amended 2026-11-18 (design D6 to D11), and again after the second perf stop (D12): task 1.3 draws occurrences round by round from a shared generator (new task 1.3a), `upcomingAll` is gone, and 1.6 is re-run; the rest of a8ad79013 is kept.

**Dependency:** until group 2 ships, the native register shows no upcoming rows (the register read no longer returns them). `native-accounts-screen` task 3.8 (Accounts on by default) must not ship before group 2 of this change. Built on branch `kenlefeb/sc-4973/native-register-upcoming-engine` (635366c1c). Tasks 1.1, 1.2 and 1.5 are kept as built. Task 1.4's `json_each` filter and counts are kept but move to the new read. Task 1.3 is reworked: it moves, gains the row cap and the one-query statuses, and leaves the register read. Task 1.6 is redone. Group 2 has not started.

## 1. loot-core: upcoming rows as they will post (sc-4973)

- [ ] 1.1 (built, keep) Move the bodies of `isScheduleRelevantToAccount`, `inverseBasedOnAccount` and `comparePreviewTransactions` verbatim into `packages/loot-core/src/shared/` with their tests. `useAccountPreviewTransactions.ts` and `usePreviewTransactions.ts` change only their imports, and the web-only steps stay in the hooks. The web register's tests (desktop `Account` and mobile `AccountTransactions`) pass unchanged (design D1)
- [ ] 1.2 (built, keep; retarget the tests at `native/account-upcoming`) Failing tests first for "The upcoming read returns rows as they will post" and "Upcoming rows name the fields rules set":
  - rules set payee and category;
  - a split's own row with `splitCount` (parent payee null, design D11);
  - a split line into this account, inverted with `transferAccount`;
  - a template split line;
  - status `due`, `upcoming` and `missed`;
  - `ruleFields`;
  - stable ids asserted in fixture `account-register-upcoming.json`;
  - native rows equal the web hook's output for the same budget, unfiltered and within the caps, comparing id, date, payee, category, notes, amount, account, split lines and transfer account.
- [ ] 1.3 (rework) `native/account-upcoming {account_id, scope, search}` in `packages/loot-core/src/server/native/accounts.ts`, registered in the native app (design D7):
  - argument checks shared with the register read;
  - relevance first, then statuses in one query for the relevant schedules only (D9);
  - occurrences drawn round by round from the shared generator (task 1.3a), stopping at the row cap `accounts-upcoming-max-rows` (default 100, ceiling 500, in `LIMITS`) or the horizon, before rules (D8, D12), returning `upcomingKept` and `upcomingMore: true` and never counting the rest;
  - then `runRules`, `ruleFields`, sort, inversion, filter and counts.

  Remove `upcoming`, `upcomingCount`, `upcomingTotal`, `upcomingCapDays` and all schedule work from `native/account-register`. Failing tests first for "Upcoming rows are their own read", "Upcoming rows are capped before rules run" (`upcomingKept`, `upcomingMore`, exactly at the cap, a monthly bill kept ahead of later weekly occurrences, about 150 dates generated for the 50-daily case, bad values), "The upcoming read returns its count and total" (returned rows only) and "Schedule statuses cost one query" (same set as `getHasTransactionsQuery` on a fixture with a split child, a tombstoned row and a closed account)
- [ ] 1.3a (new) Failing tests first for "Preview dates come from one generator" (same dates as `computeSchedulePreviewTransactions` for daily, weekly, weekend-skipping, business-day, relative, ending and paid schedules; lazy, one `getNextDate` per date taken plus at most one look-ahead). Then move the per-schedule date loop into a lazy generator in `packages/loot-core/src/shared/schedules.ts` and have `computeSchedulePreviewTransactions` drain it. The web preview's tests pass unchanged (design D12)
- [ ] 1.4 (built, keep; move) The `json_each(?)` CTE source in `registerFilter`, and the counts of "The upcoming read returns its count and total", now on the upcoming read. Keep the test past the 999-variable limit
- [ ] 1.5 (built, keep) `accounts-register-upcoming-max-days` (default 92, ceiling 366) and `upcomingCapDays`, now returned by the upcoming read. Label and help as code comments beside both limits until story 4643's registry lands (design D11)
- [ ] 1.6 (redo) `accounts.perf.test.ts`: the same seeds plus the 50-daily worst case at the 366-day ceiling; the register's first page at 50 ms and `native/account-upcoming` at 100 ms (200 schedules) and 150 ms (each worst case), each with no filter, search and `uncleared` (design D6). Run on a quiet machine, with the load average below the core count, and report the load. If the upcoming read misses, lower the default of `accounts-upcoming-max-rows` to the largest value that meets it, down to 25. **Report any default below 100 to the Product Owner before merging**, with the medians, p95s and load. Below 25, **stop and report** to the Director. Never loosen a gate
- [ ] 1.7 Bridge allowlist: `native/account-upcoming` in the Swift list and the page's list, and a `coverage.json` skip; the allowlist test passes
- [ ] 1.8 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` and `@actual-app/web` tests; all pass

## 2. Native register on iPhone (sc-4973)

Ships before `native-accounts-screen` task 3.8 turns the native Accounts screen on by default.

- [ ] 2.1 Failing tests first in `AccountsBridgeTests` and `AccountsViewModelTests`:
  - decode `native/account-upcoming`: rows, `ruleFields`, `upcomingCount`, `upcomingTotal`, `upcomingCapDays` and `upcomingMore`;
  - the register shows posted rows before the upcoming reply, with "Loading scheduled…";
  - a stale reply (older scope, search or account) is dropped by the request counter;
  - a failed upcoming read keeps the posted rows usable and shows "Couldn't load scheduled rows. Try again." with Retry, which re-reads the upcoming section only;
  - after a native write or change event, the upcoming read re-runs while the old rows stay at the same height, dimmed and marked "Updating…" (count, total and VoiceOver too), until the new reply replaces them; a reply from before the write is dropped; a failure shows the failure state with Retry;
  - an "Updating…" row opens only the read-only detail, marked "Updating…", with no swipe actions;
  - "Loading scheduled…" only for the first load and for scope or search changes;
  - "Nearest K scheduled; more not shown" from `upcomingKept`, with the total labelled partial, when `upcomingMore` is present, and plain "N scheduled" otherwise;
  - upcoming rows shown while a scope or search is set;
  - "N scheduled" and its total shown apart from the posted results;
  - both notices (`upcomingCapDays`, `upcomingMore`);
  - no Swift arithmetic on amounts.
- [ ] 2.2 `Accounts.swift` and `AccountsViewModels.swift` (`NativeBridgeCore`, the view model story 5101's Mac register will reuse) call the upcoming read after the first page and on every scope, search or change event. `NativeAccountRegisterView.swift` shows:
  - upcoming rows with category, split count, the transfer's other account and "Scheduled" in words, kept while filtered;
  - the scheduled count and total;
  - the loading, failure and Retry states, with copy in the copy table;
  - the partial count and total wording;
  - both notices.
- [ ] 2.3 Tapping an upcoming row opens the native read-only detail with "Scheduled" and "Fields set by rules: …", with no edit and no web hand-off (design D5a). UI test for a row with and without rule-set fields
- [ ] 2.4 The Limits section rows "Scheduled rows: days ahead" and "Scheduled rows: most shown". If story 4643's Limits registry has merged, add both with their name and help line, and check that changing each changes the register and its notice. If not, comment both labels and help lines on story 4643 so they land there
- [ ] 2.5 Check on the iPhone simulator against the web register, unfiltered and filtered, within the caps; record screenshots in the PR
- [ ] 2.6 Run the `NativeBridgeCore` tests and the iOS build; all pass

## 3. Archive (sc-4973)

- [ ] 3.1 After `native-accounts-screen` archives, turn "Upcoming rows are their own read" into MODIFIED deltas of "A register page is one read with a keyset cursor" (the first page adds the header only) and "The accounts handlers are allowlisted" (adds `native/account-upcoming`), then validate and archive (design D7)
