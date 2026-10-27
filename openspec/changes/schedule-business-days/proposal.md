# Proposal

## Why

Schedules can only move a date off weekends (`skipWeekend` with `weekendSolveMode` before/after), so a paycheck or bill due on a holiday still lands on the holiday. Business calendars now define holidays and non-working weekdays; schedules should use them so recurring dates match when money actually moves. This is the second step toward paycheck scheduling.

## What Changes

- A recurring schedule's "Move schedule before/after weekends" option can name a business calendar instead of plain weekends; dates then move to the nearest business day before or after in that calendar.
- The calendar choice is stored with the schedule's recurrence (`RecurConfig.businessCalendarId`), so it syncs and is visible to the public API's schedule types.
- Every place that applies weekend skipping uses the calendar: next dates, upcoming previews, schedule posting, balance forecasts and budget schedule templates.
- The schedule's recurrence description names the calendar, for example "(before non-business days in U.S. Federal Holidays)".
- If the chosen calendar is deleted or not available, the schedule falls back to plain weekend skipping and the editor says so.
- The calendar choice appears only when the business calendars experimental feature is enabled; it works in the shared recurrence editor, so desktop and mobile both get it.

Assumptions recorded here: "before" and "after" keep their meaning (nearest business day on or before / on or after); matching bank-imported transactions to schedules is unchanged; calendar management on mobile remains deferred.

## Capabilities

### New Capabilities

- `schedule-business-days`: moving recurring schedule dates off the non-business days of a chosen business calendar.

### Modified Capabilities

None. `business-calendars` requirements are unchanged; this change consumes them.

## Impact

- Types: `RecurConfig` in `packages/loot-core/src/types/models/schedule.ts` gains an optional `businessCalendarId`; existing schedules without it behave exactly as today.
- Code: weekend-skip call sites in `shared/schedules.ts`, `server/rules/rule-utils.ts`, `server/schedules/app.ts`, `server/budget/schedule-template.ts`; a shared calendar lookup loaded on the server at budget open and refreshed on sync, and on the client from the calendars query; `RecurringSchedulePicker` and `util/schedule.ts` in `desktop-client`.
- Docs: the API types page (`packages/docs/docs/api/types.jsx`) documents the new field.
- No migration: the field lives in existing rule condition JSON.
