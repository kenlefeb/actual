# Proposal

## Why

sc-2631: on the phone's transaction editor, a transaction with notes shows the notes twice, in the Notes textbox and again in the "Note preview" below it (reported by Ken on alpha.26). The preview was added so tags and receipt links are tappable (`mobile-note-links`), but showing it beside the textbox duplicates the text. This is a defect in the fork's own change (commit ddef139fd).

## What Changes

- When a transaction has notes and they are not being edited, the phone editor shows only the formatted notes, with tags and links tappable.
- Tapping the formatted text (not a link) swaps it for the Notes textbox with focus. Leaving the textbox returns to the formatted view.
- Empty notes keep showing the "Add a note (optional)" textbox.
- The formatted view (the "Note preview" today, called "formatted notes" in the spec) sits in a labeled group with a key handler, so Enter or Space starts editing, and links inside it stay real links.
- Out of scope: desktop (its notes cell has no preview), and any change to how notes are saved.

Mobile scope: `mobile/transactions/TransactionEdit.tsx`, both places that render the Notes field and "Note preview": the parent transaction (`TransactionEditInner`) and each split row (`ChildTransactionEdit`). Desktop is unaffected, with no new desktop requirement: the duplication does not exist there.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `mobile-note-links`: adds the view/edit switch for notes in the phone transaction editor. The existing link requirements are unchanged and still apply to the formatted view.

## Impact

- `desktop-client` only; no schema, server or sync change.
- `transaction-notes` was checked: its line-break and round-trip requirements concern the saved value, which this change does not alter, and its "Mobile note loses focus" scenario must keep passing once the textbox is shown only while editing.
