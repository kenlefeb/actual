# 7. Client date math takes the shared lookups explicitly

Fork-only; never upstream. Accepted 2026-10-29 (Solution Architect, from sc-555
and sc-739).

## Context

Client components compute schedule dates by calling shared functions that read
the lookups from [ADR 1](0001-synchronous-schedule-lookups.md) through module
state. The React Compiler memoizes component bodies based on the values they
visibly use. It can't see a module-state read. In sc-555 it memoized
`computeSchedulePreviewTransactions` without the calendars or schedule dates
as dependencies. So a calendar exception that arrived by sync left previews on
the old dates, while the backend's `next_date` had moved.

## Decision

Client code that runs date math reading `business-calendar-lookup` or
`schedule-date-lookup` passes the lookups in explicitly. It calls
`withScheduleLookups({ calendars, schedules }, compute)`
([`useScheduleDateLookup.ts:43-66`](../../packages/desktop-client/src/hooks/useScheduleDateLookup.ts))
inside the memo or component that computes. The calendars come from
`useBusinessCalendarLookup()` and the schedules from `useScheduleDateLookup()`.
It never relies on the lookups having been filled somewhere else, such as a
parent, another hook, or an earlier render.

Only `withScheduleLookups` fills the client lookups. The hooks return data and
fill nothing, because the React Compiler drops a fill whose result is unused
(sc-811).

## Consequences

- The lookups become visible inputs, so the compiler and `useMemo` recompute
  when calendars or schedules change. sc-555's sync tests
  (`usePreviewTransactions.calendarSync.test.tsx`) fail without this.
- **Done (sc-739, PR #78):** `PaychecksSection` and `rules/Value` now run
  their date math inside `withScheduleLookups`. `ManageRules` no longer fills
  the lookups. `PaycheckRow` and `ScheduleValue` read no lookups. Each has a
  sync test. The same PR deleted the fills in `useScheduleDateLookup` (sc-811)
  and `useBusinessCalendarLookup` (sc-908).
- Reviewers flag any new call to the date math that sits outside
  `withScheduleLookups` in `desktop-client`.

## Links

- Specs: `schedule-business-days` ("Next date and preview agree", "Calendar
  edited"), `schedule-relative-dates` ("Follows the source pattern").
- Stories: sc-555 (PR #64), sc-739, sc-811 and sc-908 (PR #78).
