# Spec Delta

## MODIFIED Requirements

### Requirement: Paychecks feature
Turning on `paychecks` SHALL also turn on `businessCalendars`. The `paychecks` feature SHALL count as on only while `businessCalendars` is on, so turning `businessCalendars` off also turns `paychecks` off. While the budget has a paycheck, `businessCalendars` SHALL not be turned off (see `business-calendars` "Experimental feature flag"). An unset `paychecks` flag SHALL start on for a budget that has `businessCalendars` on. Turning either feature off SHALL hide paycheck entry points but keep paychecks and their schedules.

#### Scenario: Turning on paychecks turns on business calendars
- **WHEN** the user turns on `paychecks` while `businessCalendars` is off
- **THEN** both features are on

#### Scenario: Existing paychecks stay visible on upgrade
- **GIVEN** a budget with the "Acme" paycheck and `businessCalendars` on, from a release before the `paychecks` feature existed
- **WHEN** the user opens it in this release
- **THEN** `paychecks` is on and "Acme" appears in the Paychecks section

#### Scenario: Acme stays hidden while business calendars are off
- **GIVEN** a budget with the "Acme" paycheck whose stored settings have `paychecks` on and `businessCalendars` off (for example, set by an earlier release)
- **WHEN** the user opens the Schedules page
- **THEN** `paychecks` counts as off: the page offers no "Add paycheck" and no Paychecks section, so the paycheck editor's calendar and days-early fields can't be reached, and Acme's schedules keep their dates

#### Scenario: Upgrade with business calendars off
- **GIVEN** a budget with the "Acme" paycheck, `businessCalendars` off and `paychecks` never set
- **WHEN** the user opens it in this release
- **THEN** `paychecks` is off, and turning on Paychecks turns both features on and shows "Acme" in the Paychecks section
