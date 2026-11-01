# Tasks

## 1. A Notifications row in the phone Settings list (sc-1848)

- [x] 1.1 Spec delta for `fork-release-news` "Notifications are reachable on a phone". Verify with `openspec validate mobile-notifications-entry --strict`.
- [x] 1.2 Add tests, extending `SettingsNav.test.tsx`, named after the scenarios and failing first: "Open the notes after dismissing the message", "The unseen count", "Off means no row" and "Desktop keeps the bell".
- [x] 1.3 Add the Notifications row to `SettingsNav` for narrow screens, shown only while the news feed is on, with the unseen count from `useNewsFeed`; do not register it as a sidebar-menu item (design.md, Decision 3). Placement and count styling follow the UX designer's answers to the open questions in design.md.
- [x] 1.4 Add a Back button to the Notifications page header on a narrow screen: previous page, falling back to /settings.
- [ ] 1.5 Archive this change when sc-1848 merges, and file Backlog stories for any open follow-up.
