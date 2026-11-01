# Tasks

## 1. No early error for an incomplete relative date (sc-1813)

- [ ] 1.1 Spec delta for `schedule-relative-dates` "Relative date definition". Verify with `openspec validate relative-date-no-early-error --strict`.
- [ ] 1.2 Add tests named after the scenarios, failing first on `development`: "No error before a source is chosen" (switching the date type to relative shows no error and an empty preview, on the desktop form and on the phone page), "Choosing a source previews as before" and "Saving without a source is refused" (the existing `RelativeDateEditor.test.tsx` "requires a source schedule" stays).
- [ ] 1.3 Make the preview effect in `useScheduleEdit.ts` treat a relative date with no source as an empty preview with no form error; leave `schedule-edit-utils.ts`'s Save-time check unchanged.
- [ ] 1.4 Check the phone page shows no message above Save until the user saves, and that Save shows it once.
- [ ] 1.5 Archive this change when sc-1813 merges, and file Backlog stories for any open follow-up.
