# Design

## Context

See proposal.md (Why). The Save-time check (`updateScheduleConditions`, `schedule-edit-utils.ts`) returns the error "Choose the schedule this date is relative to" when a relative date has no source. The preview effect in `useScheduleEdit.ts` reuses the same function to build the search conditions, and any error it returns becomes the form error.

## Decisions

### 1. An incomplete relative date is an empty preview, not an error
Before it builds conditions for the preview, the effect checks whether the date is relative and has no source schedule id. If so it clears the preview and sets no form error. The empty preview is the neutral state, so there is no new hint text to add or translate. Once a source is chosen the effect runs as it does today.

### 2. Saving keeps the check
`updateScheduleConditions` and its "requires a source schedule" test are unchanged. Save still refuses, and only then does the form show the error, once (the phone page shows it above Save, as for every other save error).

### 3. One fix for both layouts
The error is produced in the shared effect, so one change removes it from the desktop form and both phone copies. No layout code changes.

## Risks / Trade-offs

- A relative date with a source that no longer exists still reaches the preview and any error from that remains visible; this change only covers the case with no source chosen.
