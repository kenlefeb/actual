# Spec Delta

## MODIFIED Requirements

### Requirement: Experimental feature flag
Business calendar management SHALL only be available when its experimental feature is enabled in Settings. It SHALL be managed in a dialog on desktop layouts and on full pages on narrow (mobile) layouts.

#### Scenario: Feature disabled
- **WHEN** the business calendars experimental feature is off
- **THEN** no business calendar entry point is shown

#### Scenario: Feature enabled
- **WHEN** the feature is on and a user opens the Schedules page on a desktop layout
- **THEN** a control to manage business calendars is available

#### Scenario: Feature enabled on a phone
- **WHEN** the feature is on and a user opens the Schedules page on a narrow layout
- **THEN** a control to manage business calendars is available, and it opens the calendar list page instead of a dialog

## ADDED Requirements

### Requirement: Mobile calendar management
On narrow layouts, the calendar list page SHALL list the budget's calendars and let users create an empty calendar or copy a preset, and each calendar SHALL open a full-page editor with the same capabilities and validation as the desktop editor: name, non-working weekdays, holiday rules of every kind with observance, per-year exceptions, the year preview, save and delete. It SHALL use the same stored data and server operations as desktop.

#### Scenario: Create a calendar on a phone
- **WHEN** a user taps "Copy U.S. Federal Holidays preset" on the calendar list page
- **THEN** a calendar with the preset's rules is created and its editor page opens

#### Scenario: Edit a rule on a phone
- **WHEN** a user changes a holiday rule to "Days from Easter" with offset -2 and saves
- **THEN** the calendar is saved with that rule, exactly as the desktop editor saves it, and the user returns to the list

#### Scenario: Validation on a phone
- **WHEN** a user marks all seven weekdays as non-working, or enters 150 days from Easter
- **THEN** the editor explains the problem as on desktop, and an invalid Easter offset cannot be saved

#### Scenario: Wide layout
- **WHEN** a calendar page address is opened on a desktop layout
- **THEN** the user is sent to the Schedules page, where the dialog is used
