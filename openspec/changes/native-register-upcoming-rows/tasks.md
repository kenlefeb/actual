# Tasks

## 1. loot-core: upcoming rows as they will post (sc-4973)

- [ ] 1.1 Move `isScheduleRelevantToAccount`, `inverseBasedOnAccount` and `comparePreviewTransactions` into `packages/loot-core/src/shared/` with their tests; `useAccountPreviewTransactions.ts` and `usePreviewTransactions.ts` import them; the web register's tests (desktop `Account` and mobile `AccountTransactions`) pass unchanged (design D1)
- [ ] 1.2 Failing tests first for "The register's upcoming rows come from loot-core": rules set payee and category; a split's own row with `splitCount`; a split line into this account inverted with `transferAccount`; a formula split line; status `due`, `upcoming` and `missed`; native rows equal the web hook's output for the same budget, unfiltered; later pages have no `upcoming` and unchanged cursors. Fixture `account-register-upcoming.json`
- [ ] 1.3 `upcomingRows` in `packages/loot-core/src/server/native/accounts.ts`: relevance, `runRules`, sort, inversion and the row fields of design D2
- [ ] 1.4 Failing tests first for the filtered scenarios and "The register returns upcoming count and total" (separate totals, nothing upcoming, an inverted line counting once), then the CTE source in `registerFilter` and the counts (design D3, D4)
- [ ] 1.5 Failing tests first for "The upcoming horizon is a capped setting", then `accounts-register-upcoming-max-days` in `LIMITS` (default 92, ceiling 366) and the cut before rules run (design D5)
- [ ] 1.6 `accounts.perf.test.ts`: the 200-schedule seed and the three first-page cases of "The register's upcoming rows meet the latency gate" (design D6); run `yarn workspace @actual-app/core run perf`, every median under 50 ms
- [ ] 1.7 Run `yarn typecheck`, `yarn lint` and the `@actual-app/core` and `@actual-app/web` tests; all pass

## 2. Native register on iPhone (sc-4973)

- [ ] 2.1 Failing tests first in `AccountsBridgeTests` and `AccountsViewModelTests`: decode the new row fields and `upcomingCount` and `upcomingTotal` (absent on later pages, and from an older loot-core); upcoming rows shown while a scope or search is set; "N scheduled" and its total shown apart from the posted results; no Swift arithmetic on amounts
- [ ] 2.2 `Accounts.swift` and `AccountsViewModels.swift` (`NativeBridgeCore`, shared by iPhone and Mac) carry the fields; `NativeAccountRegisterView.swift` shows upcoming rows with category, split count and the transfer's other account, keeps them while filtered, and shows the scheduled count and total
- [ ] 2.3 Check on the iPhone simulator against the web register for the same budget, unfiltered and filtered; record screenshots in the PR
- [ ] 2.4 Run the `NativeBridgeCore` tests and the iOS build; all pass
