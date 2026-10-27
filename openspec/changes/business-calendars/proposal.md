# Proposal

## Why

Paychecks and many bills fall on "business days", but Actual only knows Saturday and Sunday as non-working days (`skipWeekend`) and has no holidays at all. Business days also differ by party: an employer may observe a Saturday holiday on Friday while the Federal Reserve does not, and holidays change year to year. A reusable business calendar is the foundation for paycheck scheduling and is useful on its own for any date that must avoid non-working days.

## What Changes

- Add user-defined business calendars stored in the budget, so they sync with it.
- A calendar defines its non-working weekdays and a set of holiday rules, such as a fixed date ("July 4"), an nth weekday of a month ("4th Thursday of November") and a last weekday of a month ("last Monday of May").
- A holiday rule can carry an observance shift for weekend holidays (for example Saturday to Friday, Sunday to Monday, or no shift).
- Each calendar can add or remove specific dates for a given year (exceptions), such as a one-off company closure or a late-published holiday.
- Provide at least one preset calendar (US Federal Reserve) that users can copy and edit.
- Answer whether a date is a business day in a calendar, and find the nearest business day on or before / on or after a date.
- Provide a desktop screen to create, view and edit calendars, and to preview a year's resulting non-business days. Mobile management is deferred until schedules use calendars.
- Ship behind an experimental feature flag, fully translated, so it can be contributed upstream.

Out of scope here, planned as follow-up changes building on this one:

1. `schedule-business-days`: schedules skip non-business days of a chosen calendar instead of only weekends.
2. `schedule-relative-dates`: a schedule date defined as N business days before or after another schedule's date, in a given calendar; receiving accounts carry their calendar and deposit rule (for example "2 business days early").
3. `paychecks`: a paycheck editor that maintains one on-budget clearing account per employer (holding the employer calendar), one split transaction on the pay date (gross pay and deductions) and one transfer per direct deposit, all as linked schedules.

## Capabilities

### New Capabilities

- `business-calendars`: defining business calendars (non-working weekdays, rule-based holidays with observance, per-year exceptions, presets) and answering business-day questions against them.

### Modified Capabilities

None.

## Impact

- Data: new synced budget tables for calendars, holiday rules and exceptions, with a migration; existing budgets are unaffected until a calendar is created.
- Code: `packages/loot-core` (model types, server handlers, business-day evaluation in shared code so client and server agree) and `packages/desktop-client` (desktop calendar management UI, experimental feature flag).
- API: no public `@actual-app/api` methods in this change; automation access arrives with the schedule changes that consume calendars.
- No change to existing schedules or `skipWeekend` behavior in this change.
- Upstream-ready: US Federal Reserve is the only preset; other regions are built by users from the same rule types.
