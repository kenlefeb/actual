# Proposal

## Why

Many employers, banks and countries close on days computed from Easter, such as Good Friday and Easter Monday. Business calendar holiday rules can only express fixed dates and weekday-of-month dates, so users must add these days as per-year exceptions by hand. The `business-calendars` change listed movable feasts as a non-goal "for now" (Shortcut sc-40).

## What Changes

- Add a fourth holiday rule kind: a number of days from Western (Gregorian) Easter Sunday, for example Good Friday (-2), Easter Sunday (0) and Easter Monday (+1).
- The rule uses the same observance settings as other rules.
- The desktop holiday-rule editor can create and edit the new kind, behind the existing `businessCalendars` experimental flag.
- The stored rule format gains the new kind without a migration; existing calendars are unchanged.

Non-goals: Orthodox (Julian) Easter, other lunar or movable feasts, mobile editing (sc-38), and new presets. The existing U.S. presets do not model Easter-based days, so no preset changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `business-calendars`: holiday rules gain an Easter-relative kind, editable in the desktop editor.

## Impact

- Code: `packages/loot-core` (rule type, pure Easter computation in `shared/business-calendars.ts`, server validation) and `packages/desktop-client` (holiday-rule editor).
- Data: no migration. Rules are JSON; older clients ignore the unknown kind when evaluating, as `ruleDate` already does, but their server validation rejects saving a calendar that contains it.
- No change to schedules, paychecks or existing calendars.
