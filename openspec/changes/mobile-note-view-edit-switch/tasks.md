# Tasks

Write each test first, run it and see it fail before implementing. Name tests after the spec scenarios. Paths are under `packages/desktop-client/` unless stated.

## 1. Notes view/edit switch (sc-2631)

- [ ] 1.1 In `src/components/mobile/transactions/TransactionEdit.test.tsx` (extend it), add failing tests: "Open a transaction that has notes" (one `Note preview`-style formatted view, no `Notes` textbox), "Empty notes" (textbox with the "Add a note (optional)" placeholder), "Tap to edit" (textbox appears focused with the note, formatted view gone), "Blur returns to the formatted view" (including a multiline note keeping every line break, so `transaction-notes` "Mobile note loses focus" still holds), "Clear the note", and "Tag and link in the formatted notes" (tapping a link does not start an edit). See them fail.
- [ ] 1.2 Add the same checks for a split row ("Notes on a split row") and the keyboard cases ("Keyboard activation": Enter and Space on the formatted view; role button with the Notes label). See them fail.
- [ ] 1.3 Create `src/components/mobile/transactions/NotesField.tsx` (design decisions 1 to 4) and use it in both `ChildTransactionEdit` and `TransactionEditInner`, replacing the textbox-plus-"Note preview" pairs. Keep strings translated (`t`/`Trans`). Verify 1.1 and 1.2 pass and that the existing TransactionEdit tests still pass.
- [ ] 1.4 Add or update a mobile e2e in `e2e/` (`*.mobile.test.ts`) for tap-to-edit and blur on a transaction with notes; update any VRT snapshot of the editor only by `running-vrts`.
- [ ] 1.5 Check on an iPhone build (Ken's device, or the simulator): tapping the notes raises the keyboard (design risk). Record the result in the PR.

## 2. Release note

- [ ] 2.1 Add the fork release note and `fork/release-notes/` entry for the version bump per AGENTS.md, then run `yarn generate:fork-news`.
