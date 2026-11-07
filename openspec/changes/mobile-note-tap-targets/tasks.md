## 1. Tap targets in mobile notes (sc-2913)

- [ ] 1.1 Create `packages/desktop-client/src/components/mobile/transactions/NotesField.test.tsx` (none exists yet) with failing tests: tapping a tag does not show the Notes textbox; tapping a file-path link does not show it and runs the link action (Electron: `openInFileManager`; browser: clipboard write and "File path copied to clipboard"); tapping plain text still shows it. Run it and see these fail before any fix
- [ ] 1.2 Mark tags (`MobileTaggedNotes`) and file-path links (`MobileLinkedNotes`) with `data-note-interactive`
- [ ] 1.3 Widen the `NotesField` tap guard to `closest('a, [data-note-interactive]')`
- [ ] 1.4 Add a test that the tag span has no tap handler of its own (no `onClick`/`onPress`), so a tag tap does nothing but is not an edit
- [ ] 1.5 E2E/VRT: none needed, because the change is a click guard with no layout or visual change and the component tests cover every tap path; record this in the PR
- [ ] 1.6 Run lint, typecheck and tests, including the existing `MobileLinkedNotes` tests
- [ ] 1.7 Add `upcoming-release-notes/mobile-note-tap-targets.md` (Bugfixes)
