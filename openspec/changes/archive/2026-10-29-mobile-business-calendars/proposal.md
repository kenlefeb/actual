# Proposal

## Why

Business calendars can only be created and edited on desktop layouts. The `business-calendars` change deferred mobile management "until schedules use calendars", and `schedule-business-days` deferred it again. Schedules, relative dates and paychecks now all use calendars, so a phone user can pick a calendar but cannot create or fix one (Shortcut sc-38).

## What Changes

- On narrow layouts the Schedules page gets a "Business calendars" control, behind the existing `businessCalendars` experimental flag.
- It opens a mobile page listing the budget's calendars, with controls to create an empty calendar or copy a preset.
- Each calendar opens a full-page editor with the same capabilities as the desktop editor: name, non-working weekdays, holiday rules of every kind (including days from Easter) with observance, per-year exceptions, year preview, save and delete.
- The control that opens calendar management opens the desktop dialog on wide layouts and the mobile pages on narrow layouts.

Non-goals: new rule kinds, new presets, any server or data change, and changing the desktop dialog.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `business-calendars`: calendar management becomes available on narrow (mobile) layouts as pages.

## Impact

- Code: `packages/desktop-client` only (two mobile pages, two routes, the Schedules entry points). The shared evaluation (`shared/business-calendars.ts`, presets) and the existing `business-calendar-*` server handlers are reused unchanged.
- Data: none.
