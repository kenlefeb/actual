# [Bug]: "Upcoming dates" still lists a date after "Skip next scheduled date"

- Status: draft, not filed
- Type: Bug report
- Checked against upstream `master` at `dff6b4b` (code reading); seen in this fork's paycheck editor, which uses the same preview. Reproduce on <https://edge.actualbudget.org> before filing.

## What happened?

I skipped the next date of a repeating schedule with "Skip next scheduled date". The schedule list then showed the following date as next, as expected. But when I opened the schedule, its "Upcoming dates" list still started with the date I had just skipped.

I expected "Upcoming dates" to start from the schedule's next date, so a skipped date would not appear. Instead it shows the dates the repeat pattern produces from today and ignores skips, so it looks like the skip did not work.

The preview comes from `schedule/get-upcoming-dates`, which takes only the date config and lists occurrences from today (`getUpcomingDates` in `packages/loot-core/src/server/schedules/app.ts`). It never sees the schedule's stored `next_date`.

## How can we reproduce the issue?

1. Go to Schedules and add a schedule that repeats weekly, starting on a future date.
2. Save it, and note its next date in the schedule list.
3. Select the schedule, open its menu and choose "Skip next scheduled date".
4. The schedule list now shows the following week as the next date.
5. Open the schedule. "Upcoming dates" still lists the skipped date first.

## Where are you hosting Actual?

Docker

## What browsers are you seeing the problem on?

Chrome

## Operating System

Mac OSX
