## Why

sc-2913 (found in review of PR #239, sc-2631): on the mobile transaction
editor, the formatted notes start editing on any tap except a tap inside an
`<a>`. Two other tappable things inside the notes are not `<a>` elements, so
tapping them opens the Notes textbox instead of doing their own thing:

- a tag (`MobileTaggedNotes` renders a `Text`);
- a file-path link (`MobileLinkedNotes` renders a `Text` with `onClick` that
  opens the file manager in Electron, or copies the path to the clipboard in a
  browser and shows a "File path copied to clipboard" message).

Web links already behave as the spec says.

## What Changes

- A tap on a tag in the formatted mobile notes does not start editing. Mobile
  tags have no action of their own today, so the tap does nothing else; the
  note stays formatted.
- A tap on a file-path link runs the link's action (open in file manager, or
  copy to clipboard with the message) and does not start editing.
- A tap on plain text still starts editing; keyboard activation is unchanged.
- Tests cover a tag tap and a file-path tap (both browser and Electron).

## Mobile scope

Mobile only: `NotesField` (`components/mobile/transactions/`) and the notes
renderers `MobileTaggedNotes` and `MobileLinkedNotes` (`notes/`). Desktop has
no tap-to-edit on formatted notes, so there is nothing to change there and no
exception from Ken is needed.

## Capabilities

### Modified Capabilities
- `mobile-note-links`: the "Tap the formatted notes to edit" requirement gains
  tag and file-path scenarios.

## Impact

Code: `NotesField.tsx`, `MobileTaggedNotes.tsx`, `MobileLinkedNotes.tsx` and
their tests. No API, data or dependency changes. User-facing bug fix, so it
needs a release note or fork news entry.
