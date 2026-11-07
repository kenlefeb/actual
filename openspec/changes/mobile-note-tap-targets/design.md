## Context

`NotesField` wraps the formatted notes in a group whose `onClick` calls
`startEditing()` unless `event.target.closest('a')`. Web links are `<a>`;
file-path links and tags are `Text` spans, so the guard misses them.

## Decisions

- **Widen the guard by marking elements, not by listing tags.** Tags and
  file-path links carry a `data-note-interactive` attribute; the guard becomes
  `closest('a, [data-note-interactive]')`. A future tappable element opts in by
  setting the attribute, and `NotesField` need not know every renderer.
  Alternative considered: `stopPropagation` in each renderer. Rejected for tags
  because it would make an inert element look interactive, and it already
  exists as the web-link workaround.
- **Tag tap is a no-op.** `MobileTaggedNotes` has no handler. The story says
  "whatever tags do in the formatted view"; on mobile that is nothing. Filtering
  by tag is out of scope and would be a separate story.
- **File-path action is unchanged.** Only the tap no longer also starts an
  edit.
- The "another field is being edited" case is unchanged: tapping does nothing.

## Risks

A tag or path with a tiny hit area makes plain-text taps near it ambiguous;
the existing text spans are inline, so this matches the current web-link
behavior.
