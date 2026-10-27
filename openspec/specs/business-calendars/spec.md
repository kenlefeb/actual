# business-calendars Specification

## Purpose
Lets users define which days count as business days for a party such as an employer or bank, using weekly non-working days, rule-based holidays with observance and per-year exceptions, and answers business-day questions against those definitions.

## Requirements

### Requirement: Calendars are stored in the budget
Users SHALL be able to create, rename, edit and delete named business calendars. Calendars SHALL be saved in the budget, sync to other devices with it, and support undo.

#### Scenario: Create and rename a calendar
- **WHEN** a user creates a calendar named "Acme Corp" and later renames it "Acme Payroll"
- **THEN** the budget contains one calendar named "Acme Payroll"

#### Scenario: Delete a calendar
- **WHEN** a user deletes a calendar
- **THEN** it no longer appears in the calendar list

### Requirement: Non-working weekdays
Each calendar SHALL define which weekdays are non-working, defaulting to Saturday and Sunday, and SHALL keep at least one working weekday.

#### Scenario: Default weekend
- **WHEN** a user creates a calendar without changing its weekdays
- **THEN** Saturdays and Sundays are not business days in it

#### Scenario: Every weekday non-working
- **WHEN** a user tries to mark all seven weekdays as non-working
- **THEN** the change is rejected with an explanation

### Requirement: Rule-based holidays
A calendar SHALL support named holiday rules of three kinds: a fixed month and day, the nth (first to fourth) weekday of a month, and the last given weekday of a month. Each rule SHALL produce one holiday per year.

#### Scenario: Fixed date
- **WHEN** a calendar has a fixed-date rule for July 4
- **THEN** July 4 of every year is a holiday in it

#### Scenario: Nth weekday
- **WHEN** a calendar has a rule for the 4th Thursday of November
- **THEN** November 26, 2026 and November 25, 2027 are holidays in it

#### Scenario: Last weekday
- **WHEN** a calendar has a rule for the last Monday of May
- **THEN** May 25, 2026 is a holiday in it

### Requirement: Holiday observance
Each holiday rule SHALL have an observance setting for holidays falling on a non-working weekday: no shift, Sunday to the following Monday only, or Saturday to the preceding Friday and Sunday to the following Monday. The observed date SHALL be the non-business day, and may fall in an adjacent year.

#### Scenario: Saturday holiday shifted to Friday
- **WHEN** a July 4 rule uses Saturday-to-Friday, Sunday-to-Monday observance and July 4 falls on a Saturday
- **THEN** the preceding Friday, July 3, is the non-business day

#### Scenario: Sunday-only observance
- **WHEN** a rule uses Sunday-to-Monday observance and its holiday falls on a Saturday
- **THEN** no weekday is added as a holiday for it

#### Scenario: Observance crosses a year boundary
- **WHEN** a January 1 rule uses Saturday-to-Friday observance and January 1, 2028 is a Saturday
- **THEN** December 31, 2027 is a non-business day

### Requirement: Per-year exceptions
A calendar SHALL allow specific dates to be marked as non-business days or as business days. Exceptions SHALL override weekday and holiday rules for that date.

#### Scenario: One-off closure
- **WHEN** a user marks December 26, 2026 as a non-business day
- **THEN** December 26, 2026 is not a business day, and December 26, 2027 is unaffected

#### Scenario: Working holiday
- **WHEN** a user marks a date that a holiday rule produces as a business day
- **THEN** that date is a business day in the calendar

### Requirement: U.S. Federal Holidays preset
The system SHALL offer a U.S. Federal Holidays preset containing the eleven annual federal holidays, with Saturday holidays observed the preceding Friday and Sunday holidays the following Monday. Creating a calendar from the preset SHALL produce an independent, editable copy.

#### Scenario: Create from preset
- **WHEN** a user creates a calendar from the U.S. Federal Holidays preset
- **THEN** the new calendar contains New Year's Day, Martin Luther King Jr. Day, Washington's Birthday, Memorial Day, Juneteenth, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving Day and Christmas Day

#### Scenario: Saturday holiday observed on Friday
- **WHEN** a calendar created from the preset is checked for July 2026
- **THEN** Friday, July 3, 2026 is not a business day

### Requirement: U.S. Federal Reserve preset
The system SHALL offer a U.S. Federal Reserve preset with the same eleven holidays, observing Sunday holidays the following Monday and not moving Saturday holidays. Creating a calendar from it SHALL produce an independent, editable copy.

#### Scenario: Saturday holiday not moved
- **WHEN** a calendar created from the Federal Reserve preset is checked for July 2026
- **THEN** Friday, July 3, 2026 is a business day

#### Scenario: Sunday holiday moved to Monday
- **WHEN** a calendar created from the Federal Reserve preset is checked for July 2027
- **THEN** Monday, July 5, 2027 is not a business day

#### Scenario: Editing a copy
- **WHEN** a user edits a calendar created from the preset
- **THEN** the preset and other calendars created from it are unchanged

### Requirement: Business-day queries
For any calendar and date, the system SHALL answer whether the date is a business day and find the nearest business day on or before, or on or after, the date.

#### Scenario: Nearest business day on or before
- **WHEN** asked for the nearest business day on or before Saturday, July 4, 2026 in a calendar whose only holiday is July 4 with Saturday-to-Friday observance
- **THEN** the answer is Thursday, July 2, 2026

#### Scenario: Date already a business day
- **WHEN** asked for the nearest business day on or after a date that is a business day
- **THEN** the answer is that date

### Requirement: Year preview
The calendar editor SHALL show every non-business day other than regular non-working weekdays for a chosen year, with the name of the holiday or exception that causes it.

#### Scenario: Preview a year
- **WHEN** a user previews 2026 for a calendar created from the U.S. Federal Holidays preset
- **THEN** the preview lists each 2026 federal holiday on its observed date with its name

### Requirement: Experimental feature flag
Business calendar management SHALL only be available when its experimental feature is enabled in Settings, and SHALL be managed on desktop layouts.

#### Scenario: Feature disabled
- **WHEN** the business calendars experimental feature is off
- **THEN** no business calendar entry point is shown

#### Scenario: Feature enabled
- **WHEN** the feature is on and a user opens the Schedules page on a desktop layout
- **THEN** a control to manage business calendars is available
