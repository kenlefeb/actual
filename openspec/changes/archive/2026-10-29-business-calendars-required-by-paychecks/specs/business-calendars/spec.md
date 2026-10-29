# Spec Delta

## MODIFIED Requirements

### Requirement: Experimental feature flag
Business calendar management SHALL only be available when its experimental feature is enabled in Settings. It SHALL be managed in a dialog on desktop layouts and on full pages on narrow (mobile) layouts. While the budget has a paycheck and the feature is on, Settings SHALL not let the user turn the feature off, and SHALL say that paychecks use business calendars. With no paycheck, turning the feature off SHALL also turn off the `paychecks` feature.

#### Scenario: Feature disabled
- **WHEN** the business calendars experimental feature is off
- **THEN** no business calendar entry point is shown

#### Scenario: Feature enabled
- **WHEN** the feature is on and a user opens the Schedules page on a desktop layout
- **THEN** a control to manage business calendars is available

#### Scenario: Feature enabled on a phone
- **WHEN** the feature is on and a user opens the Schedules page on a narrow layout
- **THEN** a control to manage business calendars is available, and it opens the calendar list page instead of a dialog

#### Scenario: Can't turn off while the Acme paycheck exists
- **GIVEN** the budget has the "Acme" paycheck and both features are on
- **WHEN** the user opens Settings > Experimental
- **THEN** the Business calendars toggle is on and disabled, and a note says "Paychecks use business calendars. Delete your paychecks to turn this off."

#### Scenario: Turning off business calendars with no paycheck turns off paychecks
- **GIVEN** the budget has no paycheck and both features are on
- **WHEN** the user turns off Business calendars
- **THEN** both features are off

#### Scenario: Unlocked after the last paycheck is deleted
- **GIVEN** both features are on and "Acme" was the budget's only paycheck
- **WHEN** the user deletes "Acme" and opens Settings > Experimental
- **THEN** the Business calendars toggle can be turned off, and the note is gone
