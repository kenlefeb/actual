## Context

`TransactionEdit.tsx` renders the Notes `TextareaField` and, under it, a "Note preview" `View` with `NotesTagFormatter` when `notes` is set. The same pair exists twice: `ChildTransactionEdit` (split rows, ~line 555) and `TransactionEditInner` (parent, ~line 1558).

## Decisions

1. **One small component, used at both sites.** A `NotesField` in `mobile/transactions/` owns `isEditing` and renders either the formatted view or the existing `TextareaField` plus `NoteTagAutocomplete`. Two copies of the switch would drift. The parent passes `onFocus`, `onBlur`, `onChange`; the child passes `onFocus` and `onUpdate` only. So `NotesField` itself sets `isEditing=false` on blur (in addition to calling any passed `onBlur`) and `isEditing=true` on the textarea's own focus.
2. **Editing state.** The textbox shows when `isEditing || !notes`. Setting `isEditing` on the textarea's focus means that typing into an empty note keeps the textbox mounted when `notes` becomes non-empty after the first keystroke. Tap sets `isEditing` and focuses the textarea. The textarea is `defaultValue`-based, so remounting on each edit start picks up the saved value.
3. **Focus on tap (iOS keyboard).** Primary: in the tap handler, `flushSync(() => setIsEditing(true))` then `noteRef.current.focus()` synchronously, so focus stays inside the user gesture. Fallback, only if the device check fails: keep the textarea always mounted but visually hidden (not `display:none`, which cannot take focus) and call `focus()` synchronously in the tap handler. The PR records which was used.
4. **Tap on a link or tag does not edit.** The wrapper's click handler ignores events from inside `a`/tag elements, keeping the `mobile-note-links` rule that a link tap does not open the transaction or start an edit.
5. **Accessibility without `role="button"`.** A button makes its children presentational and nests links in a button (axe `nested-interactive`). Instead the formatted view is a `role="group"` labeled "Notes" with `tabIndex=0` and a key handler (Enter or Space on the group itself, not on inner links, starts editing). Links stay links.
6. **Another field active.** The textarea is `disabled` when `editingField` names a different field. In that case the group has `aria-disabled` and the tap and key handlers do nothing.

## Risks

- Focus after the swap may not raise the iOS keyboard. Check on a device (task 1.6); use the fallback in decision 3 if it fails.
