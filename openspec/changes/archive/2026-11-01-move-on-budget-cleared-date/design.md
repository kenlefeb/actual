# Design

## Context

See proposal.md (Why). In `MoveOnBudgetModal.tsx`, `isDateValid` is a regular expression for the `YYYY-MM-DD` shape; the preview effect returns early when it fails, without clearing the earlier `preview`; the sentences are built from `shownDate`, which is empty for a cleared date; and Move is disabled with `!preview || !isDateValid || isMoving`.

## Decisions

### 1. A new requirement, not a change to "Start date"
The scenarios go in a new requirement, "A cleared or invalid start date". The existing "Start date" requirement owns the default and "the counts follow the start date"; sc-1530 will modify it to change the default. Keeping this change in its own requirement means the two changes touch different requirements and cannot conflict in OpenSpec.

### 2. No usable date means no preview and a hint
When the date is empty or not a real date, the dialog sets the preview to nothing and shows the hint in the preview's place; Move stays disabled, and the hint is the visible reason. A valid date fetches the preview as it does today.

### 3. A real-date check
The shape check lets 2026-02-31 through, and the server refuses it with "Invalid start date". The dialog uses the shared `isValidYearMonthDay` (already used by the server's move code) so such a date is handled as unusable before any request.

### 4. Interaction with the default start date (sc-1530)
sc-1530 will default the date to the month of the account's earliest transaction, which has to be looked up when the dialog opens. While that lookup runs there is no date yet, and the dialog must not flash "Choose a start date" for it: the hint is for a date the user cleared or typed badly, not for a default still loading. Whoever implements the later of the two stories keeps that distinction (for example a loading state before the hint). Both stories edit the same component, so expect a textual merge, not a spec conflict.

### 5. Same on desktop and phone
The dialog is one component with a narrow-width layout, so one fix covers both.

## Risks / Trade-offs

- The hint is a new translated string; it is added with `Trans` like the dialog's other text.
