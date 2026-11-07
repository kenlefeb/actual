## Context

`TransactionEdit.tsx` renders the Notes `TextareaField` and, under it, a "Note preview" `View` with `NotesTagFormatter` when `notes` is set. The same pair exists twice: `ChildTransactionEdit` (split rows, ~line 555) and `TransactionEditInner` (parent, ~line 1558).

## Decisions

1. **One small component, used at both sites.** A `NotesField` in `mobile/transactions/` owns `isEditing` and renders either the formatted view or the existing `TextareaField` plus `NoteTagAutocomplete`. Two copies of the switch would drift. The parent and child keep passing their own `onFocus`/`onBlur`/`onUpdate`/`onChange` handlers.
2. **Editing state is local; empty notes always edit.** The textbox shows when `isEditing || !notes`. Tap sets `isEditing` and focuses the textarea (its `ref`, `noteRef`, must exist before focus, so focus in an effect after the swap). Blur sets it false. Because the textarea is `defaultValue`-based, remount on each edit start is fine and picks up the saved value.
3. **Tap on a link or tag does not edit.** The wrapper's click handler ignores events from inside `a`/tag elements, which keeps the `mobile-note-links` rule that a link tap does not open the transaction or start an edit.
4. **Accessibility.** The formatted view is `role="button"`, `tabIndex=0`, `aria-label` "Notes", Enter/Space start editing. It is a button containing links; the nested interactive elements stay reachable, which is acceptable here because the alternative (a separate Edit button) adds a control to a crowded form. Revisit if screen-reader testing shows trouble.
5. **`editingField` interplay.** Starting an edit calls the existing `onRequestActiveEdit` through the textarea's `onFocus`, so other fields disable themselves exactly as today.

## Risks

- Focus after swap may not raise the iOS keyboard if it is not within the tap's user gesture. Check on a device (task 3.1); if it fails, render the textarea hidden-but-mounted instead of unmounting the formatted view.
