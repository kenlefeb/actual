# Design

## Context

See proposal.md for motivation and specs/business-calendars/spec.md for required behavior. Actual's only non-working-day concept is `skipWeekend` on schedule recurrence (`packages/loot-core/src/shared/schedules.ts`), hard-coded to Saturday and Sunday. Recent synced entities such as account groups follow one pattern: a SQL migration, a server module under `packages/loot-core/src/server/<module>/app.ts` registered in `server/main.ts` and `types/handlers.ts`, an AQL schema entry, a client query hook refreshed from `desktop-client/src/sync-events.ts`, and a modal. New user-facing features ship behind a `FeatureFlag` (`types/prefs.ts`, `useFeatureFlag.ts`, `settings/Experimental.tsx`).

## Goals / Non-Goals

**Goals:**
- One storage, evaluation and UI path that later schedule and paycheck changes reuse unchanged.
- Business-day evaluation that is pure and deterministic, usable from client and server.

**Non-Goals:**
- Using calendars in schedules, accounts or paychecks (follow-up changes).
- Mobile management screens, public API methods, importing calendars (iCal) or locale-specific presets beyond U.S. Federal Holidays and U.S. Federal Reserve.
- Movable feasts (for example Easter-based holidays); users add them as yearly exceptions for now.

## Decisions

### One table with JSON rule columns
A single `business_calendars` table: `id`, `name`, `non_working_days` (JSON array of weekday numbers, 0 = Sunday), `holidays` (JSON array of rules), `exceptions` (JSON array of `{ date, isBusinessDay, name }`), `tombstone`. Rules are `{ id, name, kind: 'fixed' | 'nth-weekday' | 'last-weekday', month, day?, weekday?, nth?, observance: 'none' | 'sunday-to-monday' | 'nearest-weekday' }`.

- Why: rules and exceptions are small, edited as a unit in one editor, and never queried individually. Actual's `rules` table already stores conditions and actions as JSON text, so this matches an existing convention and keeps the migration to one table.
- Alternative: separate holiday and exception tables. Rejected because it triples the migration, AQL schema and sync wiring for no query need. Trade-off accepted: concurrent edits to the same calendar on two devices resolve last-writer-wins per column.

### Pure evaluation module in shared code
`packages/loot-core/src/shared/business-calendars.ts` exports `getHolidays(calendar, year)` (observed dates with names, including observed dates spilling from adjacent years), `isBusinessDay(calendar, date)` and `getNearestBusinessDay(calendar, date, direction)`. It uses `date-fns` and ISO `YYYY-MM-DD` strings like `shared/months.ts`, with no database access.

- Why: schedules already compute dates in `shared/schedules.ts`; keeping calendars beside it lets the follow-up schedule changes call it directly from client previews and server posting.
- Search for the nearest business day is bounded to 366 days and throws when no business day is found. That can only happen if exceptions cover a whole year, so it is a guard, not a rule.

### Observance semantics
`nearest-weekday` moves a Saturday holiday to the preceding Friday and a Sunday holiday to the following Monday; `sunday-to-monday` moves only Sunday; `none` never moves. The shift applies only when the holiday falls on a non-working weekday of that calendar, and steps one day at a time to the closest working weekday in the shift direction. To catch spillover (January 1 observed on December 31), `getHolidays(year)` evaluates rules for `year - 1`, `year` and `year + 1` and keeps observed dates inside `year`.

### Presets as code, copied on create
Presets live in `shared/business-calendar-presets.ts` as plain calendar definitions. "Create from preset" inserts a new row with copied rules, so later preset fixes never silently change a user's calendar. U.S. Federal Holidays: the 11 holidays in the spec, all `nearest-weekday` (OPM observance), weekend Saturday and Sunday; Inauguration Day is omitted because it applies only around Washington, D.C. U.S. Federal Reserve: the same rules with `sunday-to-monday`, derived from the federal list so the two cannot drift. Because loot-core has no i18n and holiday names become user-editable data, the client copies the preset, replaces its calendar and holiday names with translations keyed by preset and holiday id, and sends the full calendar to `business-calendar-create`.

### Server handlers
`business-calendars-get`, `business-calendar-create`, `business-calendar-update` and `business-calendar-delete` (singular for mutations, matching account groups), wrapped in `mutator(undoable(...))` like `tags/app.ts`. The server validates input at this boundary: at least one working weekday, valid month/day combinations, `nth` from 1 to 4, unique exception dates, and ISO dates.

### Desktop UI behind `businessCalendars` flag
A "Business calendars" button on the Schedules page header (desktop only, flag on) opens a `BusinessCalendarsModal` listing calendars with create, create-from-preset, rename and delete. Selecting a calendar opens an editor with weekday toggles, a holiday rule list, an exceptions list and a year picker with the preview from `getHolidays`. Built with `@actual-app/components` and `Trans`, matching `AccountGroupsModal`.

## Risks / Trade-offs

- [Observance rules vary more than three options cover (for example a Monday-only shift for Saturday holidays)] → The three cover U.S. federal, Federal Reserve-style and common employer policies; exceptions handle the rest, and the `observance` field can gain values without a migration.
- [Rule JSON drifts from the TypeScript type over time] → Validate on write in the server handlers and parse defensively on read, ignoring unknown rule kinds instead of failing the calendar.
- [Upstream may prefer a different entry point than the Schedules page] → The modal is self-contained, so moving the entry point is a one-line change.

## Migration Plan

Add a migration creating `business_calendars`. Existing budgets need no data changes; the table stays empty until a calendar is created. Rollback is dropping the feature flag; the empty or unused table is harmless.
