# Design

## Context

See proposal.md (Why). Desktop reaches the page through `NotificationsButton` in the titlebar, which shows the unseen count from `useNewsFeed().unseenCount` and is hidden while the news feed is off. A phone has no titlebar and no shared header; its Settings page is a list of rows built by `SettingsNav` and `SettingsNavLink` (40px minimum height).

## Decisions

### 1. A row in the phone Settings list
The entry point is a Notifications row in the phone Settings list, two taps from anywhere (Settings, then Notifications). It reuses the list's existing row component, so it meets the 40px touch height already required there.

### 2. The same signals as the desktop bell
The row is shown only while the news feed is on (the setting that means "no feed, no request") and shows the number of unseen entries from the same `useNewsFeed` values the bell uses, so both agree. The count is gone once the page has been opened, as today.

### 3. A fixed row, not a sidebar-menu item
The row is added in `SettingsNav` beside General, Advanced and Experimental. It is not registered as a sidebar-menu item, because that registry drives the user-customizable desktop sidebar and adding an id there would change that feature.

### 4. Nothing else changes
Desktop keeps the bell and gains no row. The "What's new" message and the link in the About group stay.

## Open questions (for the UX designer; not decided here)

- Where the row sits in the list (right after General, or above Advanced).
- How the unseen count is styled on a 40px row in all three themes.
- Whether the Settings tab in the bottom bar also shows a marker when entries are unseen.
- Whether the Notifications page needs a back button on a narrow screen now that it is reached from a list (check at implementation).

The spec and tests stay true whichever way these go: they assert that the row exists, opens the page, shows the count and is absent when notifications are off.
