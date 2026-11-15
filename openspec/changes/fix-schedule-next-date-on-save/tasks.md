# Tasks

Test-first: write each test, run it and see it fail, then fix. One PR.

## 1. Next date on save agrees with load and keeps skips (sc-4437)

- [ ] 1.1 Add a failing loot-core test: save an unchanged "Acme" paycheck (no business calendars) whose pay schedule has a skipped November 30. The pay and deposit next dates are unchanged after the save. Then make `areConditionValuesEqual` ignore keys whose value is `undefined`. Verify: the test passes and the existing schedule and paycheck tests pass.
- [ ] 1.2 Add a failing test: with the clock at Sunday November 15, 2026, create a "move before weekends" monthly schedule on the 15th. The stored next date is November 30, and a load (`advanceSchedulesService`) leaves it unchanged. Add a regression test that the load's recompute for a paid schedule is unchanged: a non-posting schedule with next date Oct 31 whose transaction imports Nov 14 still gets Nov 13 (shown as missed). Then apply design Decision 2 in `createSchedule` and in `setNextDate` when `reset` is true, leaving `getNextDateFrom` unchanged. Verify: both tests pass, along with the existing "moved after the weekend onto today" tests.
- [ ] 1.3 Add failing tests for a date change, each scenario in the delta: a skip whose occurrence still exists is kept; a skip whose occurrence no longer exists is dropped; an added pay date (Nov 16, adding the 20th) gives Nov 20. Then implement design Decision 3 in `setNextDate`'s reset path. Verify: the tests pass.
- [ ] 1.3a Add failing paycheck tests that check the pay schedule and every deposit schedule's next date: an unchanged save keeps them all, adding the 8th keeps November 30 skipped for each deposit (next Dec 8), and changing to the 1st and 20th moves each to Nov 20. Then implement design Decision 4 in `refreshRelativeDependents`. Verify: the tests pass.
- [ ] 1.4 Run the loot-core suite and the native paychecks list tests (`native/schedules-paychecks`) unchanged. Verify: all pass, and `yarn typecheck` passes.
