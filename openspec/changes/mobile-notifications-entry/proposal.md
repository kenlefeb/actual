# Proposal

## Why

On a phone the only obvious way to the Notifications page is the "See what's new" button on the "What's new in Actual <version>" message. A user who dismisses that message cannot find the release notes again (Shortcut sc-1848). The page is routed on narrow screens, and a link exists far down in Settings (General, then About, then the "Updates" row), but nothing persistent and findable leads there. Desktop already has the titlebar bell.

The `fork-release-news` spec only requires the first-run message to link to the page. It never says how a phone user gets back later, even though its purpose is that every release's notes reach users through the in-app notifications page.

## What Changes

- **Spec:** adds the requirement "Notifications are reachable on a phone": on a narrow screen, with in-app notifications on, the Settings page has a Notifications row that opens the page and shows the number of unseen entries; the row is absent when in-app notifications are off.
- **Behavior (the story's implementation):** the phone Settings list gains that row. The desktop bell, the "What's new" message and the About link stay as they are.

Non-goals: where exactly the row sits, how its count is styled, and whether the Settings tab itself shows a marker. These are open design questions for the UX designer (see design.md), so the spec does not fix them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fork-release-news`: adds one requirement.
