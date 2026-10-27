# Design

## Context

See proposal.md for motivation and specs/schedule-business-days/spec.md for behavior. A schedule's recurrence (`RecurConfig`) lives in its rule's date condition JSON. Weekend skipping is applied through `getDateWithSkippedWeekend(date, solveMode)` in `packages/loot-core/src/shared/schedules.ts`, called from `getNextDate` (via `RSchedule` data set in `server/rules/rule-utils.ts` `parseRecurDate`), `server/schedules/app.ts` `getUpcomingDates`, and `server/budget/schedule-template.ts`. `getNextDate` is synchronous and runs in both the backend worker (posting, forecasts, templates) and the client thread (`usePreviewTransactions` → `computeSchedulePreviewTransactions`). Calendars are rows in `business_calendars`, evaluated by `shared/business-calendars.ts`.

## Goals / Non-Goals

**Goals:**
- One shared function decides the moved date for every caller, so previews, posting and forecasts never disagree.
- Zero behavior change for schedules without a calendar.

**Non-Goals:**
- Changing how bank-imported transactions match schedules (`isapprox` date conditions).
- Relative dates between schedules and per-account deposit rules (`schedule-relative-dates`).
- Mobile calendar management.

## Decisions

### Store the calendar id in RecurConfig
Add optional `businessCalendarId?: string` to `RecurConfig`, kept alongside `skipWeekend` and `weekendSolveMode`. `skipWeekend` stays the on/off switch; the id only changes what counts as a skipped day.

- Why: the recurrence already round-trips through rule conditions, sync, undo and the API; no migration or new table is needed.
- Alternative: a column on `schedules`. Rejected because date logic reads the rule condition, not the schedule row, and would need both kept in step.

### Shared synchronous calendar lookup
Add `shared/business-calendar-lookup.ts` holding a `Map` of calendars with `setBusinessCalendars(list)` and `getBusinessCalendar(id)`. Extend `getDateWithSkippedWeekend(date, solveMode, calendarId?)`: with a found calendar it returns `getNearestBusinessDay(calendar, day, solveMode === 'before' ? 'before' : 'after')`; otherwise it keeps today's weekend logic.

- Server: load all calendars when a budget opens (beside `loadMappings` in `server/budgetfiles/app.ts`), reload after the business-calendar handlers mutate, and reload from an `addSyncListener` callback when `business_calendars` changes, following `db/mappings.ts`.
- Stored schedule `next_date` values are computed once, so each calendar create, edit and delete recomputes them (via `setNextDate`) for active schedules whose rule references a business calendar, inside the same undoable mutation so undo restores both. Remote devices receive the recomputed dates through normal sync.
- Client: `useBusinessCalendarLookup()` fills the lookup from the `useBusinessCalendars` query during render and returns the calendars, so `usePreviewTransactions` and recurrence descriptions recompute when calendars load or change. A one-time effect in `FinancesApp` was rejected because effects run after children compute previews, leaving them stale until an unrelated re-render.
- Why: keeps `getNextDate` synchronous and avoids threading calendars through every caller. Alternative: pass calendars as a parameter everywhere; rejected as invasive across forecasts, templates and previews.
- Trade-off: a lookup that has not loaded yet falls back to weekends, so a preview could briefly differ on first render; the query refresh corrects it.

### Thread the id through call sites
`parseRecurDate` adds `businessCalendarId` to `RSchedule` data; `getNextDate`, `getUpcomingDates` and `schedule-template.ts` pass it to `getDateWithSkippedWeekend`. `noSkipWeekend` keeps its meaning (raw occurrence, used by `getNextDateAfter`).

### Editor and description
`RecurringSchedulePicker` (shared by desktop and mobile schedule editing) replaces the fixed "weekend" label with a select of "weekends" plus each calendar's "non-business days in {{name}}", shown only when the `businessCalendars` flag is on. If the stored id has no calendar, the select shows a "missing calendar" entry and an inline note that weekends are used. `util/schedule.ts` uses the lookup to describe "(before non-business days in {{name}})", falling back to the weekend wording.

## Risks / Trade-offs

- [Lookup not populated in some entry point, for example the public API package] → `@actual-app/api` runs the server code path, so the budget-open load covers it; a test asserts the lookup is filled after loading a budget.
- [Holiday-heavy calendars push dates across month boundaries] → Intended; budget templates already iterate actual moved dates, and tests cover a move into the previous month.
- [Flag turned off leaves calendar-based schedules without a visible way to change the calendar] → The editor still shows the stored choice read-only with an option to switch back to weekends.

## Migration Plan

None: new field is optional inside existing JSON. Older clients ignore `businessCalendarId` and use weekends, the documented fallback.
