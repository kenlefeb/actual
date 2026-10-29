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
([`useScheduleDateLookup.ts:43-67`](../../packages/desktop-client/src/hooks/useScheduleDateLookup.ts))
inside the memo or component that computes. The calendars come from
`useBusinessCalendarLookup()` and the schedules from `useScheduleDateLookup()`.
It never relies on the lookups having been filled somewhere else, such as a
parent, another hook, or an earlier render.

The hooks still fill the lookups during render. That's allowed. The rule is
about inputs, not about where the fill happens (sc-555's original criterion,
"no longer fill during render", was dropped).

## Consequences

- The lookups become visible inputs, so the compiler and `useMemo` recompute
  when calendars or schedules change. sc-555's sync tests
  (`usePreviewTransactions.calendarSync.test.tsx`) fail without this.
- **Code that doesn't follow this yet (sc-739):** `PaychecksSection`,
  `PaycheckRow`, `rules/Value`, `ManageRules` and `ScheduleValue` read the
  lookups implicitly. They're correct today only because the compiler doesn't
  compile them, so a refactor or a compiler upgrade could make them stale.
  sc-739 moves them onto `withScheduleLookups` and gives each one a sync test.
- Reviewers flag any new call to the date math that sits outside
  `withScheduleLookups` in `desktop-client`.

## Links

- Specs: `schedule-business-days` ("Next date and preview agree", "Calendar
  edited"), `schedule-relative-dates` ("Follows the source pattern").
- Stories: sc-555 (PR #64), sc-739.
