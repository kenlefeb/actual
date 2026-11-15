# Proposal

## Why

Shortcut sc-4437 (priority bug). Saving a schedule or paycheck can store a next date that is already past, a date moved back before the weekend, and it drops a paycheck's skips even when its pay dates did not change. The next budget load then moves the date on, so save and load disagree and the date jumps by itself. Losing skips can hit Ken's real paychecks.

## What Changes

- A save whose dates and account did not change keeps the schedule's next date, and so its skips. This applies to a paycheck's pay schedule and deposit schedules too.
- A save that needs a new next date (a new schedule, or changed dates or account) picks the same date a budget load would: the earliest occurrence whose moved date is today or later. A date moved back before today is never a next date.
- When the dates change, a skip of an occurrence that still exists is kept. Skips of occurrences that no longer exist are dropped.
- Web and native saves get the fix together, because both go through loot-core's schedule save.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `schedule-business-days`: adds the rule that the next date after a save equals the next date after a load, and is never a moved date before today.
- `paychecks`: adds the rule that saving a paycheck keeps its next dates and skips unless its pay dates change.

## Mobile scope

No UI changes. The web phone screens and the native iPhone screens save through the same loot-core handlers, so they get the fix with no screen work.

## Decisions for Ken

None. The PO settled the rule on sc-4437 (comment 4440).

## Impact

`packages/loot-core/src/server/schedules/app.ts`: `getNextDateFrom`, `setNextDate`'s reset path, and the condition comparison in `areConditionValuesEqual`. Tests in loot-core.
