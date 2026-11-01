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

## UX decisions (UX designer, mock: Figma node 3-474 in file T8dvalNySZboEI17QlwRCb)

### 5. Position and size
The row goes right after General, because it is the one row about reading rather than configuring and the count is most useful where it is seen first. It is 40px high with the same icon, label and chevron as its neighbours.

### 6. The count pill
The pill sits between the label and the chevron: 20px high, at least 20px wide, 6px side padding, fully rounded, 12px bold text with tabular numbers. It uses the themed `pillBackgroundSelected` and `pillTextSelected` pair, not the bell's white on `buttonPrimaryBackground`, which fails for 12px text in midnight (3.5:1). A test checks the pair is at least 4.5:1 in light, dark and midnight. The count is capped at "9+" like the bell, and the row's screen-reader label is "Notifications: N unread". With nothing unseen there is no pill.

### 7. No Settings tab dot
One count on the row is enough; a dot on the tab would repeat it and suggest settings need attention. The "What's new" message already announces a release.

### 8. Back on the Notifications page
On a narrow screen the page header has a Back button. It goes back to where the user came from and falls back to /settings when there is no history to go back to, so it works when the page is opened from the "What's new" message.
