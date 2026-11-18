# Tasks

## 1. loot-core: upcoming rows as they will post (sc-4973)

- [ ] 1.1 Move the bodies of `isScheduleRelevantToAccount`, `inverseBasedOnAccount` and `comparePreviewTransactions` verbatim into `packages/loot-core/src/shared/` with their tests. `useAccountPreviewTransactions.ts` and `usePreviewTransactions.ts` change only their imports, and the web-only steps stay in the hooks. The web register's tests (desktop `Account` and mobile `AccountTransactions`) pass unchanged (design D1)
- [ ] 1.2 Failing tests first for "The register's upcoming rows come from loot-core" and "Upcoming rows name the fields rules set":
  - rules set payee and category;
  - a split's own row with `splitCount`;
  - a split line into this account, inverted with `transferAccount`;
  - a formula split line;
  - status `due`, `upcoming` and `missed`;
  - `ruleFields` for payee and category, and empty when no rule changes anything;
  - stable ids in the documented format, asserted in fixture `account-register-upcoming.json`;
  - native rows equal the web hook's output for the same budget, unfiltered and within the cap, comparing id, date, payee, category, notes, amount, account, split lines and transfer account;
  - later pages have no `upcoming` and unchanged cursors.
- [ ] 1.3 `upcomingRows` in `packages/loot-core/src/server/native/accounts.ts`: relevance, `runRules`, `ruleFields`, sort, inversion and the row fields of design D2
- [ ] 1.4 Failing tests first for the filtered scenarios, "The register returns upcoming count and total" (separate totals, nothing upcoming, an inverted line counting once) and more rows than SQLite's variable limit (over 999 and over 32,766 variables' worth). Then the `json_each(?)` CTE source in `registerFilter` and the counts (design D3, D4)
- [ ] 1.5 Failing tests first for "The upcoming horizon is a capped setting" (cut at the cap, `upcomingCapDays` present only when a row was cut, bad values). Then `accounts-register-upcoming-max-days` in `LIMITS` (default 92, ceiling 366), with its label and help text for the Limits section (design D5)
- [ ] 1.6 `accounts.perf.test.ts`: the 200-schedule seed, the three first-page cases and the worst case of 50 daily schedules across the full 92-day cap (design D6). Run `yarn workspace @actual-app/core run perf`. Every median must be under 50 ms. If any is not, **stop and report** the medians and p95s to the Director; do not skip or loosen the gate. The remedy (a lower default cap, or a named row-cap limit) is decided by the Architect and the Product Owner
- [ ] 1.7 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` and `@actual-app/web` tests; all pass

## 2. Native register on iPhone (sc-4973)

- [ ] 2.1 Failing tests first in `AccountsBridgeTests` and `AccountsViewModelTests`:
  - decode the new row fields, `ruleFields`, `upcomingCount`, `upcomingTotal` and `upcomingCapDays` (absent on later pages, and from an older loot-core);
  - upcoming rows shown while a scope or search is set;
  - "N scheduled" and its total shown apart from the posted results;
  - the cap notice shown only with `upcomingCapDays`;
  - no Swift arithmetic on amounts.
- [ ] 2.2 `Accounts.swift` and `AccountsViewModels.swift` (`NativeBridgeCore`, the view model story 5101's Mac register will reuse) carry the fields. `NativeAccountRegisterView.swift` shows:
  - upcoming rows with category, split count, the transfer's other account and "Scheduled" in words, kept while filtered;
  - the scheduled count and total;
  - the cap notice.
- [ ] 2.3 Tapping an upcoming row opens the native read-only detail with "Scheduled" and "Fields set by rules: …", with no edit and no web hand-off (design D5a). UI test for a row with and without rule-set fields
- [ ] 2.4 The Limits section row "Scheduled rows: days ahead": if story 4643's Limits section has merged, check the row shows with its label, text, default and ceiling, and that changing it changes the register and its notice. If not, comment the label and text on story 4643 so it lands there
- [ ] 2.5 Check on the iPhone simulator against the web register, unfiltered and filtered, within the cap; record screenshots in the PR
- [ ] 2.6 Run the `NativeBridgeCore` tests and the iOS build; all pass
