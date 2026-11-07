# Tasks

Write each test first, run it and see it fail before implementing. Name tests after the spec scenarios. Paths are under `packages/desktop-client/` unless stated.

## 1. Notes view/edit switch (sc-2631)

- [x] 1.1 In `src/components/mobile/transactions/TransactionEdit.test.tsx` (extend it), add failing tests: "Open a transaction that has notes" (one formatted view, no `Notes` textbox), "Empty notes" (textbox with the "Add a note (optional)" placeholder), "Type into an empty note" (typing one character keeps the textbox mounted and focused), "Tap to edit" (textbox appears focused with the note, formatted view gone), "Blur returns to the formatted view" (including a multiline note keeping every line break, so `transaction-notes` "Mobile note loses focus" still holds), "Clear the note", "Tag and link in the formatted notes" (the link has `target="_blank"` and activating it starts no edit), and "Another field is being edited" (tap does nothing, group has `aria-disabled`). See them fail.
- [x] 1.2 Add the same checks for a split row ("Notes on a split row"; its handlers differ: no `onBlur`, so blur must still return to the formatted view) and the keyboard cases ("Keyboard activation": Enter and Space on the group; labeled group, links still links). See them fail.
- [x] 1.3 Create `src/components/mobile/transactions/NotesField.tsx` (design decisions 1 to 6) and use it in both `ChildTransactionEdit` and `TransactionEditInner`, replacing the textbox-plus-"Note preview" pairs. Keep strings translated (`t`/`Trans`). Verify 1.1 and 1.2 pass and that the existing TransactionEdit tests still pass.
- [x] 1.4 Add or update a mobile e2e in `e2e/` (`*.mobile.test.ts`) for tap-to-edit and blur on a transaction with notes; update any VRT snapshot of the editor only by `running-vrts`.
- [x] 1.5 Run `yarn typecheck` and `yarn lint:fix`; confirm there are no new `t`/`Trans` lint failures.
- [x] 1.6 Check on an iPhone build (Ken's device, or the simulator): tapping the notes raises the keyboard. Record in the PR whether the primary approach (`flushSync` + `focus()` in the tap handler) or the hidden-textarea fallback was used.

## 2. Release note (sc-2631)

- [x] 2.1 Add an `upcoming-release-notes/` entry (short slug) worded "notes no longer appear twice" on the phone transaction editor. No version bump: releases are cut by separate release stories.
