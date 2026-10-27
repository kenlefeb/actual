# Design

## Context

See proposal.md for motivation and specs/schedule-relative-dates/spec.md for behavior. A schedule's date lives in its rule's `date` condition: a string for one-time dates or a `RecurConfig` for repeating ones. `CONDITION_TYPES.date.parse` (`server/rules/condition.ts`) turns it into `{ type: 'date' }` or `{ type: 'recur', schedule: RSchedule }`; `isapprox` matching checks `schedule.occursBetween(date - 2, date + 2)`. `getNextDate` (`shared/schedules.ts`) is synchronous, runs in the backend and the client, and applies the move-off-non-business-days option through the business-calendar lookup added by `schedule-business-days`. Stored `next_date` values are recomputed by `setNextDate`; calendar changes already trigger that for schedules using a calendar.

## Goals / Non-Goals

**Goals:**
- Relative dates reuse the existing date pipeline so every caller (next date, previews, posting, forecasts, templates, matching) supports them with one shared computation.
- No migration and no new table.

**Non-Goals:**
- Paycheck groups, account deposit rules, clearing accounts (`paychecks`).
- Mirroring skips or posts between schedules; chaining relative schedules.

## Decisions

### New date-condition value shape
A relative date is stored as `{ relativeTo: { scheduleId, offset, unit: 'days' | 'business-days', direction: 'before' | 'after' }, businessCalendarId?, skipWeekend?, weekendSolveMode? }` (a `RelativeDateConfig` type next to `RecurConfig`). `parse` returns `{ type: 'relative', config }`; `isapprox` is allowed for it.

- Why: schedules already treat the date condition as the single source of truth for dates, so rules, sync, undo and the API carry the new shape for free.
- Alternative: a new schedule column. Rejected for the same reason as `schedule-business-days`: date logic reads the rule condition.

### Shared source-date lookup
`shared/schedule-date-lookup.ts` maps schedule id → that schedule's date condition. The backend fills it at budget load and refreshes it from rule changes (sync listener on `rules`, and the schedule mutations); the client fills it from the cached schedules list in the same render-time way as `useBusinessCalendarLookup`. A shared `getRelativeOccurrences(config, from, to)` asks the source's parsed date for its occurrences in a widened window, applies the source's own move to each, then applies the offset (calendar days with date-fns, or business days by stepping with `isBusinessDay` from `shared/business-calendars.ts`, defaulting to a Saturday/Sunday calendar), then the relative schedule's own move option.

- Why: keeps `getNextDate` and condition matching synchronous on both sides; mirrors the proven calendar lookup.
- The window is widened by the offset plus 14 days for moves, so occurrences near the edges are not lost.

### Callers
`getNextDate` and `isapprox`/`is` matching branch on `type: 'relative'` and use `getRelativeOccurrences`. A source that is missing or itself relative yields no occurrences. `getUpcomingDates` accepts a relative config. Forecasts and budget templates already call `getNextDate`.

### Keeping stored next dates current
When a schedule's rule changes or a schedule is deleted, the backend recomputes `next_date` (`setNextDate`) for schedules whose date condition is relative to it, inside the same mutation so undo restores both. Calendar changes already recompute schedules whose conditions mention a calendar; relative schedules mention `businessCalendarId` the same way.

### Editor and display
`ScheduleEditForm` replaces the "Repeats" checkbox with a date-type choice (one date, repeats, relative to another schedule) when the `businessCalendars` flag is on or the schedule is already relative; otherwise the existing checkbox remains. The relative editor offers non-relative schedules as sources, offset, unit, direction, calendar (business days only), and the existing move option, with an upcoming-dates preview. Descriptions read, for example, "2 business days before Payday (U.S. Federal Holidays)". A missing source shows "Source schedule was deleted" in the editor and the schedules list.

## Risks / Trade-offs

- [Older clients cannot parse the new date shape] → Accepted for the experimental, fork-only feature; such clients show the schedule's date as invalid instead of crashing.
- [Matching window around business-day offsets across long holidays] → Computed dates are matched with the standard ±2-day window; tests cover a holiday-adjacent deposit.
- [Performance of computing occurrences on demand] → Windows are small (one occurrence at a time for next dates, the upcoming period for previews).

## Migration Plan

None: new shape inside existing JSON. Rollback: delete relative schedules or switch them to repeating dates before downgrading.
