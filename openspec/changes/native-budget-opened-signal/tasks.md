# Tasks

## 1. The budget-opened signal (sc-5496)

- [ ] 1.1 Failing tests first, run and seen failing: loot-core sends `budget-opened` once after the open, not on a failed open, again on a reopen; the slow-open hook delays the open and is a no-op at 0; the page forwards the event; `check-test-hooks` catches the new markers
- [ ] 1.2 loot-core: `connection.send('budget-opened')` beside `markBudgetOpen()` in `_loadBudget`; the event in the server event types; `__FORK_TEST_SLOW_OPEN_MS__` in `vite.config.mts` and the hook before `markBudgetOpen()`
- [ ] 1.3 Page: add `budget-opened` to `EVENTS` in `nativeBridge.ts`
- [ ] 1.4 `fork/scripts/check-test-hooks.mjs`: markers `__FORK_TEST_SLOW_OPEN_MS__` and `__forkTestSlowOpen`; confirm the iPhone Release build phase refuses them
- [ ] 1.5 Failing Swift tests first for `AccountsListViewModel`, `BudgetViewModel` and `PaychecksViewModel` (failed re-reads once and loads; loaded does not read; loading is superseded; an older read's refusal after the event does not overwrite the newer read; failed re-read stays failed; background does not read), then `budgetOpened()` on each
- [ ] 1.6 Failing test first, through each shell's real event path (`NativeBridgePlugin` and `MacEngineHost.receive`): `budget-opened` reaches `budgetOpened()` and not the coalescer, `onChange` or `onPaychecksEvent`, so a loaded Budget screen does not read; then route it in the iPhone Accounts, Budget and Paychecks controllers and the Mac host, returning before the change path
- [ ] 1.7 Slow-open proof: Fork CI builds a page with `FORK_TEST_HOOKS=true FORK_TEST_SLOW_OPEN_MS=6000`; an iPhone UI test (Accounts loads with no tap on Retry) and a `HomeEconomicsMacTests` test (the Budget view model ends loaded through `MacEngineHost`'s real event path); neither bundles that page into a Release or archive build
- [ ] 1.8 Architect and Product Owner review of this spec; then archive with `native-open-gate` (sc-5463 closes after this story)
