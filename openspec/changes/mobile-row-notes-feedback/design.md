# Design

## Decisions

1. **Pressed tint from shared press state.** `TransactionListItem.tsx` already merges one set of press and long-press props onto the button and onto the notes overlay (`ignoreInteractiveTargets(mergeProps(pressProps, longPressProps))`). Add `onPressStart`, `onPressEnd` (which also fires on cancel) to the notes overlay's props to set a local `isNotesPressed`, and apply the button's own pressed background to the row while it is true. Nothing is nested; a press that starts on a tag never reaches the overlay's handlers (propagation is stopped), so a tag press shows no row tint (scenario "Press a tag"). Rejected: a CSS `:active` on the overlay (does not cover touch cancel or long press reliably) and moving the notes back into the button (the sc-3070 defect).
2. **Notes in the button's accessible name via `aria-labelledby`.** Give the button an id and the overlay's text an id, and set the button's `aria-labelledby` to both ids (`"<buttonId> <notesId>"`; the self-reference keeps the button's own content in the name). The notes text is read, tags and links stay separate controls outside the button. Use React `useId` for the ids; set the attribute only when the row has notes so a row without notes keeps its name. Rejected: `aria-describedby` (the PO and finding ask for the name; a description is read less reliably) and duplicating the notes text in `aria-label` (drifts from the displayed notes).
2a. **A press that never ends.** A press starting on a link or tag does not reach the overlay's handlers (propagation is stopped), so it never sets `isNotesPressed`. As a guard for a press that does start on the overlay and loses its end (window blur, new window), `isNotesPressed` is also cleared on `onPressUp`, pointer cancel and window `blur`, so the tint cannot stay held and the next tap still opens the transaction.
3. **Axe criterion unchanged.** The sc-3070 e2e keeps asserting that no tag or link is a descendant of a button and no `nested-interactive` node contains one. Linking by id is not nesting, so it holds. The test also gains a name check for a row with notes.
4. **Spec wording.** The editor-tag decision moves back into the text of "Tap the formatted notes to edit"; the scenario keeps the example. Both requirement texts stay under 500 characters so `openspec validate --specs --strict` passes.

## Verification

Tests first, failing first: a press on the notes line sets the row tint and a release or cancel clears it; the button's accessible name contains the notes text for a row with notes and is unchanged for a row without; a tag press leaves the tint off. The existing VRT snapshots must not change in the resting state.

## Risks

- The overlay is absolutely positioned over the button (measured against a hidden spacer); the tint must not change layout or hit areas.
- `aria-labelledby` replaces the computed name, so the self-reference must be kept; the name test pins it.
