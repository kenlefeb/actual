# Tasks

## 1. Relative date core

- [x] 1.1 Add `RelativeDateConfig` to `types/models/schedule.ts` and document it in `packages/docs/docs/api/types.jsx`; verify `yarn typecheck` passes
- [x] 1.2 Add `shared/schedule-date-lookup.ts` and `getRelativeOccurrences` (source occurrences with the source's move, then the day or business-day offset, then the relative schedule's own move); test the spec's October 13 / November 10 business-day example, the December 28 days example, business days without a calendar, a missing source and a relative source yielding no occurrences; verify the tests pass
- [x] 1.3 Parse relative date values in `CONDITION_TYPES.date` and support them in `getNextDate` and `isapprox`/`is` matching; test that an imported November 10 deposit matches and that non-relative schedules are unchanged; verify the tests pass

## 2. Server

- [x] 2.1 Fill the source-date lookup at budget load and keep it current from rule changes and schedule mutations; make `schedule/get-upcoming-dates` accept relative configs; reject saving a schedule relative to a relative schedule; test each; verify they pass
- [x] 2.2 Recompute stored next dates of dependent relative schedules when a source's rule changes or the source is deleted, inside the same undoable mutation; test source pattern edit, skip of the source leaving the relative schedule unchanged, deletion stopping dates, and undo restoring them; verify they pass

## 3. Client

- [x] 3.1 Fill the client lookup from cached schedules so previews recompute when schedules change; test that account preview transactions include a relative occurrence; verify it passes
- [x] 3.2 Add the date-type choice and relative editor to `ScheduleEditForm` behind the `businessCalendars` flag (sources exclude relative schedules), with upcoming-dates preview and the "Source schedule was deleted" state; show the deleted-source state in the schedules list; add component tests for saving a relative date, the no-chaining source list, the deleted-source message and the flag-off view; verify they pass
- [x] 3.3 Describe relative dates (for example "2 business days before Payday (U.S. Federal Holidays)") in `util/schedule.ts`; extend its tests; verify they pass
- [x] 3.4 Run `yarn generate:i18n` and verify the new strings are extracted

## 4. Integration checks

- [x] 4.1 Run `yarn typecheck`, `yarn lint` and `yarn test` from the repository root and verify they pass, except the known local-only `.memsearch/` and `.vexp/` format findings
- [x] 4.2 In the running app with the flag on, create a source schedule and "Deposit" 2 business days before it in U.S. Federal Holidays (checked with the demo budget's "Calendar test" schedule: upcoming 11/09/2026, 12/09/2026, 01/07/2027, saved next date 11/09/2026); delete the source and verify the deleted-source message, then undo and verify the dates return

## Workflow follow-up

- Release as the next fork version with its release note and feed entry (`yarn generate:fork-news`), per `AGENTS.md`.
- Archive this change after review.
- Next change: `paychecks`.
