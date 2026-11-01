# Proposal

## Why

On a phone the only obvious way to the Notifications page is the "See what's new" button on the "What's new in Actual <version>" message. A user who dismisses that message cannot find the release notes again (Shortcut sc-1848). The page is routed on narrow screens, and a link exists at the top of General, under About, in the "Updates" row, but it is a small inline link that is not labelled as release notes, so nothing persistent and findable leads there. Desktop already has the titlebar bell.

The `fork-release-news` spec only requires the first-run message to link to the page. It never says how a phone user gets back later, even though its purpose is that every release's notes reach users through the in-app notifications page.

## What Changes

- **Spec:** adds the requirement "Notifications are reachable on a phone": on a narrow screen, with in-app notifications on, the Settings page has a Notifications row that opens the page and shows the number of unseen entries; the row is absent when in-app notifications are off.
- **Behavior (the story's implementation):** the phone Settings list gains that row. The desktop bell, the "What's new" message and the About link stay as they are.

- **Back control (task 1.4):** on a narrow screen the Notifications page gains a Back button that goes to the previous page and falls back to /settings when there is no history, so it also works when the page is reached from the "What's new" message.

Non-goals: a marker on the Settings tab (decided against), and any change to the desktop bell. Row position and count styling were open questions; the UX designer's answers are recorded in design.md.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fork-release-news`: adds one requirement.
