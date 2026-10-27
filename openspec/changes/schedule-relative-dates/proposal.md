# Proposal

## Why

Some scheduled money moves are defined by another schedule's date rather than by a calendar pattern: a direct deposit lands 2 business days before payday, a card payment is due 21 days after the statement. Today each must be entered as an independent schedule, so the two drift apart when the source pattern or holidays change. This is the third step toward paycheck scheduling, after business calendars and schedule business days.

## What Changes

- A schedule's date can be **relative to another schedule**: each occurrence of the source schedule produces one occurrence of the relative schedule, offset by N **days** or **business days**, **before** or **after**.
- Business days are counted in a chosen business calendar (weekends only when none is chosen). The existing "Move schedule before/after non-business days" option then applies to the resulting date for either unit.
- Relative schedules follow the source schedule's date pattern, including later edits to it, and behave like any schedule: next date, upcoming dates, previews, posting, forecasts, budget templates and matching of imported transactions.
- Each schedule keeps its own progress: skipping or posting the source does not skip or post the relative schedule, and vice versa.
- A relative schedule cannot point at another relative schedule.
- If the source schedule is deleted, its relative schedules stop producing dates and show "Source schedule was deleted" until re-pointed or deleted; undo restores both.
- The schedule editor (shared by desktop and mobile) offers "Relative to another schedule" as a date option, behind the existing `businessCalendars` experimental flag.

Out of scope (planned for `paychecks`): per-account calendars and deposit rules, the paycheck editor, clearing accounts, and skipping a whole paycheck group.

## Capabilities

### New Capabilities

- `schedule-relative-dates`: schedules whose occurrences are derived from another schedule's occurrences by a day or business-day offset.

### Modified Capabilities

None. `schedule-business-days` and `business-calendars` are used unchanged.

## Impact

- Data: a new date-condition value shape stored in existing rule JSON; no migration. Older clients do not understand it and treat the schedule's date as invalid.
- Code: `packages/loot-core` date-condition parsing and matching (`server/rules`), schedule date math (`shared/schedules.ts`), a synchronous source-schedule lookup alongside the calendar lookup, server next-date recomputation when a source changes or is deleted; `packages/desktop-client` schedule editor and description text.
- API: the public schedule types document the new date shape.
