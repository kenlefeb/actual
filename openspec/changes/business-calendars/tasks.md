# Tasks

## 1. Evaluation core

- [ ] 1.1 Add `BusinessCalendarEntity`, holiday rule and exception types in `packages/loot-core/src/types/models/business-calendar.ts` and export them from `types/models/index.ts`; verify `yarn typecheck` passes
- [ ] 1.2 Implement `getHolidays`, `isBusinessDay` and `getNearestBusinessDay` in `packages/loot-core/src/shared/business-calendars.ts`, with `business-calendars.test.ts` covering every spec scenario for weekdays, the three rule kinds, the three observance modes, the year-boundary spillover, exceptions overriding rules and the 366-day search guard; verify the tests pass
- [ ] 1.3 Add the US Federal Reserve preset in `packages/loot-core/src/shared/business-calendar-presets.ts`, with a test asserting its 2026 and 2027 observed holiday dates against the Federal Reserve's published schedule; verify the test passes

## 2. Storage and server

- [ ] 2.1 Add a migration creating `business_calendars` (`id`, `name`, `non_working_days`, `holidays`, `exceptions`, `tombstone`), add the table to the AQL schema in `server/aql/schema/index.ts`, and update the migrations snapshot; verify `migrations.test.ts` and `additive-migrations.test.ts` pass
- [ ] 2.2 Add `packages/loot-core/src/server/business-calendars/app.ts` with get, create (optional preset), update and delete handlers using `mutator(undoable(...))`, validation at the boundary, and registration in `server/main.ts` and `types/handlers.ts`; add `app.test.ts` covering create, create from preset, rename, edit, delete, undo and each validation rejection; verify the tests pass

## 3. Desktop UI

- [ ] 3.1 Add the `businessCalendars` feature flag to `types/prefs.ts`, `useFeatureFlag.ts` and `settings/Experimental.tsx`; verify the toggle appears in Experimental settings and defaults to off
- [ ] 3.2 Add a `useBusinessCalendars` query hook and refresh it in `sync-events.ts` when `business_calendars` changes; verify edits from another device or undo refresh the list
- [ ] 3.3 Build `BusinessCalendarsModal` (list, create, create from preset, rename, delete) and the calendar editor (weekday toggles, holiday rules, exceptions, year preview) with `Trans` for all text, register the modal, and add the flag-gated, desktop-only "Business calendars" button to the Schedules page header; add component tests for the preview and the all-weekdays rejection, and verify they pass
- [ ] 3.4 Run `yarn generate:i18n` and verify the new strings are extracted

## 4. Integration checks

- [ ] 4.1 Run `yarn typecheck`, `yarn lint` and `yarn test` from the repository root and verify they pass, except the known local-only `.memsearch/` and `.vexp/` format findings
- [ ] 4.2 In the running app with the flag on, create a calendar from the US Federal Reserve preset, add a one-off closure, and verify the 2026 preview matches the spec; with the flag off, verify no entry point appears

## Workflow follow-up

- Add an `upcoming-release-notes/` entry when preparing the upstream branch; per `fork/README.md`, exclude fork version bumps and fork documentation from it.
- Archive this change after review so `business-calendars` becomes a main spec.
- Follow-up changes: `schedule-business-days`, `schedule-relative-dates`, `paychecks`.
