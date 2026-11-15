# Tasks

Test-first: write each test, run it and see it fail, then fix. One PR.

## 1. Next date on save agrees with load and keeps skips (sc-4437)

- [ ] 1.1 Add a failing loot-core test: save an unchanged "Acme" paycheck (no business calendars) whose pay schedule has a skipped November 30. The pay and deposit next dates are unchanged after the save. Then make `areConditionValuesEqual` ignore keys whose value is `undefined`. Verify: the test passes and the existing schedule and paycheck tests pass.
- [ ] 1.2 Add a failing test: with the clock at Sunday November 15, 2026, create a "move before weekends" monthly schedule on the 15th. The stored next date is November 30 and equals what `advanceSchedulesService` leaves after a load. Then change `getNextDateFrom` to prefer `getNextDateAfter(dateCond, yesterday)` (design Decision 2). Verify: the test passes, including the existing "moved after the weekend onto today" tests.
- [ ] 1.3 Add failing tests for a date change: a skip whose occurrence still exists is kept, and a skip whose occurrence no longer exists is dropped and the next date equals a load's (both spec scenarios, for a plain schedule and for a paycheck). Then implement design Decision 3 in `setNextDate`'s reset path. Verify: the tests pass.
- [ ] 1.4 Run the loot-core suite and the native paychecks list tests (`native/schedules-paychecks`) unchanged. Verify: all pass, and `yarn typecheck` passes.
