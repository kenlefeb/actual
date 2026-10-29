# 1. Synchronous lookups for business calendars and schedule dates

Fork-only; never upstream. Accepted 2026-10-29.

## Context

Upstream's schedule date math (`getNextDate`, `getDateWithSkippedWeekend`,
rule `Condition` matching) is synchronous and gets only a schedule's own date
condition. Business days need a **business calendar**, and a **relative date**
needs its **source schedule's** date. Neither is in that condition, and making
the math async would touch every upstream caller.

## Decision

Two module-level maps in `shared/` hold what the date math needs:

- [`business-calendar-lookup.ts`](../../packages/loot-core/src/shared/business-calendar-lookup.ts): calendar id → calendar.
- [`schedule-date-lookup.ts`](../../packages/loot-core/src/shared/schedule-date-lookup.ts): schedule id → date condition value (plus names, for descriptions; only the client fills those).

Each JavaScript realm fills its own copy:

- **Backend** (the worker in the browser, the main process in Electron and
  `@actual-app/api`): filled on budget load
  ([`budgetfiles/app.ts:699-700`](../../packages/loot-core/src/server/budgetfiles/app.ts)).
  It refreshes on sync through `addSyncListener`
  ([`business-calendars/app.ts:74-82`](../../packages/loot-core/src/server/business-calendars/app.ts),
  [`schedules/app.ts:335-367`](../../packages/loot-core/src/server/schedules/app.ts))
  and inside the mutations that change calendars or schedules. Those mutations
  also recompute stored `next_date` for the schedules that depend on them, in
  the same undoable mutation.
- **Client**: filled from React Query data by
  [`useBusinessCalendarLookup`](../../packages/desktop-client/src/hooks/useBusinessCalendarLookup.ts)
  and [`useScheduleDateLookup`](../../packages/desktop-client/src/hooks/useScheduleDateLookup.ts),
  which the sync and global events keep fresh. How client code may read them
  is [ADR 7](0007-client-date-math-explicit-lookups.md).

The backend is the source of truth for stored dates (`next_date`, posted
transactions). Client copies only drive display (previews, upcoming dates,
descriptions).

## Consequences

- Upstream date-math signatures stay unchanged, which keeps upstream merges
  small ([ADR 5](0005-fork-date-shapes-in-rule-conditions.md)).
- A missing entry falls back to quiet defaults: weekends only for a calendar,
  and no occurrences for a relative date. So a stale or empty copy shows wrong
  dates without raising an error. sc-555 was this kind of bug on the client.
- Any new backend entry point that does date math must call both `load*`
  functions first.
- `shared/relative-dates.ts` imports `#server/rules`, so this shared code
  depends on the server. sc-560 removes that import.

## Links

- Specs: `schedule-business-days` ("Calendar applies wherever schedule dates
  are computed"), `schedule-relative-dates`.
- Changes: `openspec/changes/archive/2026-10-27-schedule-business-days/design.md`,
  `2026-10-27-schedule-relative-dates/design.md`.
- Stories: sc-555 (PR #64), sc-560, sc-739.
