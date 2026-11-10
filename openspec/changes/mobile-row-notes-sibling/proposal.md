# Proposal

## Why

Shortcut sc-3070 (epic 470, Baseline fork behavior). Follow-up of sc-2989 (design decision 6). A tappable tag in a mobile transaction row is a `role="button"` span nested inside the row's `<button>`. The Solution Architect's exploration (sc-3070, activity-3186) ran axe-core against a mirror of the row and found `nested-interactive` (serious): assistive technology may not expose the inner control, so a screen-reader user may be unable to filter by tag. The Product Owner decided (sc-3070, activity-3188): fix it by taking the notes line out of the row's button (option C), and record that a long press on a tag does nothing.

## What Changes

- The mobile transaction list row keeps its primary `<button>` for payee, category and amount. The notes line becomes a sibling of that button, inside the same row container, so tags and links are siblings of a button, not descendants of one.
- Pressing the notes line away from a tag or link opens the transaction; long-pressing it starts multi-select, exactly as the rest of the row does. Look and pressed feedback are unchanged (visual parity, not a new design).
- Decision recorded: a long press on a tag does nothing (no selection, no filter). The tag is its own tap target.
- Decision recorded (from sc-3069, which called it a "known gap"): a tag in the mobile transaction editor stays inert. Editing is unsaved state, and filtering would leave the editor.
- Axe reports no `nested-interactive` on the mobile list, checked by a Playwright test with axe-core on a mobile viewport.
- Desktop: no behavior change. The register's `DesktopTaggedNotes` is a bare button in a table cell, not inside another button. A narrow desktop window (`isNarrowWidth`) shows the mobile list and gets the fix. Tests pin the desktop tag as a separate control.

Out of scope: letting a long press through a tag, tag behavior in the editor, row selection semantics (grid or list roles), any new visual design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-note-links`: "Tap the formatted notes to edit" (the editor-tag scenario becomes a decision) and "Tapping a tag filters the list" (row structure, notes-line press, long press on a tag, axe, desktop parity).

## Mobile scope

Mobile screens in `packages/desktop-client/src/components/mobile/`: `transactions/TransactionListItem.tsx` (row structure, shared by All accounts, single account, On/OffBudget and the reconcile layout lists). `notes/MobileTaggedNotes.tsx` keeps its behavior. The editor (`transactions/NotesField.tsx`) is unchanged. Desktop: tests only.
