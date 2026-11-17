# Spec Delta

## Purpose

How the native Budget tab's month controls use the range that `native/budget-month` reports (sc-3850). The base requirement "The native Budget tab navigates between months" and its scenarios are in `add-native-budget-screen`, whose "Month outside the range" scenario is edited there to match; this delta adds to them. The change is iOS-native only: desktop web and mobile web have their own month navigation and are unchanged.

## ADDED Requirements

### Requirement: The month controls follow the budget's range from the first load
The native Budget tab SHALL take the budget's range from each successful month read. Previous month and next month SHALL be unavailable at the first and last month, and the month picker SHALL offer exactly the months from the first to the last, with no tap needed to learn the edge. The tab SHALL NOT remember a month as missing.

#### Scenario: Opening on the first month
- **GIVEN** the native Budget tab opens on the budget's first month
- **WHEN** the first read finishes
- **THEN** previous month is unavailable and the picker offers no earlier month, and no step was sent to learn it

#### Scenario: Opening on the last month
- **GIVEN** the native Budget tab opens on the budget's last month
- **WHEN** the first read finishes
- **THEN** next month is unavailable and the picker offers no later month

#### Scenario: A month in the middle
- **GIVEN** the native Budget tab on a month between the first and the last
- **WHEN** the user opens the picker
- **THEN** it lists every month from the first to the last, and previous and next are both available

### Requirement: A month the web adds later is offered without a relaunch
After a later read reports a new `lastMonth` or `firstMonth`, the tab SHALL offer that month in next month, previous month and the picker. Any read counts: a change event, a sync, a pull to refresh, a step or returning to the tab. The app SHALL NOT need to be relaunched, and a read that fails SHALL keep the range of the last good read.

#### Scenario: The web budgets ahead
- **GIVEN** the native Budget tab on the last month, with next month unavailable
- **WHEN** the web adds a later month and the tab re-reads
- **THEN** next month and the picker offer the new month, without a relaunch

#### Scenario: A read fails
- **GIVEN** the tab showing a month with a known range
- **WHEN** the next read fails
- **THEN** the numbers stay, marked stale, and previous, next and the picker keep the last known range

### Requirement: A server without the range keeps the screen working
When a read carries no `firstMonth` and `lastMonth`, the tab SHALL still show the month, keep previous and next available, and offer a window of months around the visible one. A step the handler refuses SHALL keep the visible month and its numbers, and SHALL NOT be remembered.

#### Scenario: An older server
- **GIVEN** the page's `native/budget-month` result has no range fields
- **WHEN** the tab loads and the user taps next month past the last month
- **THEN** the tab stays on the same month with its numbers, and a later read that has the range, or a later tap, decides afresh

#### Scenario: Dynamic Type and VoiceOver
- **GIVEN** the largest accessibility text size and VoiceOver on
- **WHEN** previous or next month is unavailable at an edge
- **THEN** its control is announced as dimmed, and the picker lists the months without truncating

### Requirement: The month picker marks the month on screen
The native Budget tab's month picker SHALL mark the row of the month the tab shows, and no other row, so the user can tell where they are in the list. The picker keeps its order (newest first) and does not scroll to the marked row.

#### Scenario: The picker marks the shown month
- **GIVEN** the tab shows a month between the first and the last
- **WHEN** the user opens the picker
- **THEN** that month's row carries a checkmark and no other row does, and after a step or a pick the checkmark is on the new month
- **AND** VoiceOver announces the marked row as selected
