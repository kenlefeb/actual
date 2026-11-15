# Proposal

## Why

Shortcut sc-4437 (priority bug). Saving a schedule or paycheck can store a next date that is already past, a date moved back before the weekend, and it drops a paycheck's skips even when its pay dates did not change. The next budget load then moves the date on, so save and load disagree and the date jumps by itself. Losing skips can hit Ken's real paychecks.

## What Changes

- A save whose dates and account did not change keeps the schedule's next date, and so its skips. This applies to a paycheck's pay schedule and deposit schedules too.
- A save that needs a new next date (a new schedule, or changed dates or account) picks the earliest occurrence whose moved date is today or later, never a date moved back before today. A budget load leaves that date unchanged. The load's own recompute for a paid schedule is unchanged.
- When the dates change, a skip of an occurrence that still exists is kept, for the schedule and for schedules dated relative to it (a paycheck's deposits). Skips of occurrences that no longer exist are dropped, and occurrences the edit added show.
- Web and native saves get the fix together, because both go through loot-core's schedule save.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `schedule-business-days`: adds the rules that a save never picks a moved date before today, and that a date change keeps skips that still exist.
- `paychecks`: adds the rule that saving a paycheck keeps its next dates and skips unless its pay dates change.

## Mobile scope

No UI changes. The web phone screens and the native iPhone screens save through the same loot-core handlers, so they get the fix with no screen work.

## Decisions for Ken

None. The PO settled the rule on sc-4437 (comment 4440).

## Impact

`packages/loot-core/src/server/schedules/app.ts`: `createSchedule`, `setNextDate`'s reset path, `refreshRelativeDependents`, and the condition comparison in `areConditionValuesEqual`. Tests in loot-core.
