## 1. Tap targets in mobile notes (sc-2913)

- [ ] 1.1 Write failing tests first: in a `NotesField` test, tapping a tag does not show the Notes textbox; tapping a file-path link does not show it and runs the link action (Electron: `openInFileManager`; browser: clipboard write and "File path copied to clipboard"); tapping plain text still shows it
- [ ] 1.2 Mark tags (`MobileTaggedNotes`) and file-path links (`MobileLinkedNotes`) with `data-note-interactive`
- [ ] 1.3 Widen the `NotesField` tap guard to `closest('a, [data-note-interactive]')`
- [ ] 1.4 Run lint, typecheck and tests, including the existing `MobileLinkedNotes` tests
- [ ] 1.5 Add a release note or fork news entry
