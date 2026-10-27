# Tasks

## 1. Shared date logic

- [x] 1.1 Add optional `businessCalendarId` to `RecurConfig` in `packages/loot-core/src/types/models/schedule.ts` and document it in `packages/docs/docs/api/types.jsx`; verify `yarn typecheck` passes
- [x] 1.2 Add `packages/loot-core/src/shared/business-calendar-lookup.ts` (`setBusinessCalendars`, `getBusinessCalendar`) and extend `getDateWithSkippedWeekend` with an optional calendar id that moves to the nearest business day before/after; extend `shared/schedules.test.ts` with the spec's July 2 and January 20 scenarios, a business-day-unchanged case, a missing-calendar weekend fallback and an unchanged no-calendar case; verify the tests pass
- [x] 1.3 Pass `businessCalendarId` through `parseRecurDate` (`server/rules/rule-utils.ts`) into `RSchedule` data and on to `getDateWithSkippedWeekend` in `getNextDate`; add a test that `getNextDate` returns the moved holiday date for a recurring condition with a calendar; verify it passes

## 2. Server call sites and loading

- [x] 2.1 Use the calendar id in `getUpcomingDates` (`server/schedules/app.ts`) and both skip sites in `server/budget/schedule-template.ts`; add tests showing upcoming dates and a schedule template target use moved dates; verify they pass
- [x] 2.2 Load calendars into the lookup at budget open (beside `loadMappings` in `server/budgetfiles/app.ts`), after each business-calendar mutation, and from an `addSyncListener` callback on `business_calendars`; add a test that editing a calendar changes a schedule's next date without editing the schedule, and that a deleted calendar falls back to weekends; verify they pass

## 3. Client

- [x] 3.1 Add `useBusinessCalendarLookup` (fills the lookup and returns calendars) and use it in `usePreviewTransactions` so previews recompute when calendars change; add a test that account preview transactions use a moved date; verify it passes
- [x] 3.2 In `RecurringSchedulePicker`, behind the `businessCalendars` flag, replace the fixed "weekend" label with a select of weekends and each calendar, show a missing-calendar entry with a note when the stored id is unknown, and keep weekends-only UI when the flag is off; add component tests for selecting a calendar, the missing-calendar note and the flag-off view; verify they pass
- [x] 3.3 Update `util/schedule.ts` so descriptions read "(before|after non-business days in {{name}})" with a calendar and keep the weekend wording otherwise; extend `util/schedule.test.ts`; verify it passes
- [x] 3.4 Run `yarn generate:i18n` and verify the new strings are extracted

## 4. Integration checks

- [x] 4.1 Run `yarn typecheck`, `yarn lint` and `yarn test` from the repository root and verify they pass, except the known local-only `.memsearch/` and `.vexp/` format findings
- [x] 4.2 In the running app with the flag on, set a monthly schedule on the 11th to move before non-business days in a U.S. Federal Holidays calendar and verify the editor preview, description and stored next date show Tuesday, November 10, 2026 (Veterans Day moved); delete the calendar and verify the stored next date returns to November 11, the description uses the weekend wording and the editor shows the missing-calendar note. Account-register previews are covered by the hook test

## Workflow follow-up

- Building a deployable version from this needs a new `26.10.1-alpha.N` version and release note, per `AGENTS.md`.
- Archive this change after review so `schedule-business-days` becomes a main spec.
- Next change: `schedule-relative-dates`.
