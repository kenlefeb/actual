# Proposal

## Why

Switching a schedule's date to "Relative to another schedule" shows a red "Could not search: Choose the schedule this date is relative to" in the transactions area before the user has typed anything, and on a phone it shows a second time above Save (Shortcut sc-1813). The user hasn't picked a source yet, so nothing is wrong. The message comes from the Save-time check in `schedule-edit-utils.ts`, which the preview effect in `useScheduleEdit.ts` also runs and turns into a form error that `ScheduleEditForm` labels "Could not search" and `MobileScheduleEditPage` shows again.

The `schedule-relative-dates` spec has scenarios for saving and for the source being chosen, but none for the state in between, so the behavior was never specified.

## What Changes

- **Spec:** adds scenarios to "Relative date definition": until a source schedule is chosen the form shows no error and the preview is empty; choosing a source previews as before; saving without a source is refused.
- **Behavior (the story's implementation):** the preview treats an incomplete relative date as an empty preview with no form error, on desktop and phone. The Save-time check stays.

Non-goals: a new hint string (the empty preview is the neutral state, so there is no new text to translate), and any change to validation of a completed relative date.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `schedule-relative-dates`: "Relative date definition" gains three scenarios.
