# schedule-business-days Specification

## Purpose
Lets a recurring schedule move its dates off the non-business days of a chosen business calendar, so scheduled bills and paychecks fall on the days money actually moves rather than only avoiding weekends.

## Requirements

### Requirement: Choose a business calendar for date moves
A recurring schedule that moves dates before or after non-working days SHALL let the user choose either plain weekends or one of the budget's business calendars. Schedules without a chosen calendar SHALL behave exactly as before.

#### Scenario: Existing schedule unchanged
- **WHEN** a schedule moves dates before weekends and has no calendar chosen
- **THEN** its dates are moved only off Saturdays and Sundays, as before

#### Scenario: Choose a calendar
- **WHEN** a user sets a schedule to move dates before non-business days in "U.S. Federal Holidays" and saves it
- **THEN** reopening the schedule shows that calendar selected

### Requirement: Dates move to the nearest business day
For a schedule with a chosen calendar, each occurrence that is not a business day in that calendar SHALL move to the nearest business day on or before it when set to "before", or on or after it when set to "after".

#### Scenario: Holiday moved earlier
- **WHEN** a monthly schedule on the 4th moves dates before non-business days in a U.S. Federal Holidays calendar
- **THEN** its July 2026 occurrence is Thursday, July 2, 2026, because July 3 is the observed holiday and July 4 is a Saturday

#### Scenario: Holiday moved later
- **WHEN** a monthly schedule on the 19th moves dates after non-business days in a U.S. Federal Holidays calendar
- **THEN** its January 2026 occurrence is Tuesday, January 20, 2026, because January 19 is Martin Luther King Jr. Day

#### Scenario: Business day unchanged
- **WHEN** an occurrence already falls on a business day of the chosen calendar
- **THEN** its date is not moved

### Requirement: Calendar applies wherever schedule dates are computed
The chosen calendar SHALL be used for the schedule's next date, its upcoming-date preview in the editor, preview transactions in account registers, posted transactions, balance forecasts and budget schedule templates.

#### Scenario: Next date and preview agree
- **WHEN** a schedule's next occurrence falls on a holiday in its chosen calendar
- **THEN** the schedule's next date, the editor's upcoming dates and the account's preview transaction all show the moved date

#### Scenario: Calendar edited
- **WHEN** a user adds an exception to a calendar that a schedule uses
- **THEN** the schedule's upcoming dates reflect the exception without editing the schedule

### Requirement: Missing calendar falls back to weekends
If a schedule's chosen calendar has been deleted or is not available, the schedule SHALL move dates off weekends only and the schedule editor SHALL say that the calendar is missing.

#### Scenario: Calendar deleted
- **WHEN** a user deletes a calendar that a schedule uses
- **THEN** the schedule's dates move off weekends only
- **AND** the schedule editor shows that the chosen calendar no longer exists

### Requirement: Recurrence description names the calendar
A schedule's recurrence description SHALL name the chosen calendar, and SHALL keep the existing weekend wording when no calendar is chosen.

#### Scenario: Description with a calendar
- **WHEN** a monthly schedule moves dates before non-business days in "U.S. Federal Holidays"
- **THEN** its description ends with "(before non-business days in U.S. Federal Holidays)"

### Requirement: Calendar choice behind the experimental flag
The calendar choice SHALL only be offered when the business calendars experimental feature is enabled. Schedules that already use a calendar SHALL keep using it when the feature is turned off.

#### Scenario: Feature disabled
- **WHEN** the business calendars experimental feature is off
- **THEN** the recurrence editor offers only the weekend option

#### Scenario: Feature turned off later
- **WHEN** a schedule uses a calendar and the feature is turned off
- **THEN** the schedule's dates still use that calendar
