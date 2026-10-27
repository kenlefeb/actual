# schedule-relative-dates Specification

## Purpose

Lets a schedule take its dates from another schedule, offset by a number of days or business days, so related money movements such as a direct deposit before payday or a card payment after a statement stay in step with their source.

## Requirements

### Requirement: Relative date definition
A schedule's date SHALL be definable as relative to another schedule: an offset count (zero or more), a unit of days or business days, a direction of before or after, and for business days an optional business calendar.

#### Scenario: Save a relative schedule
- **WHEN** a user sets a schedule's date to 2 business days before "Payday" in U.S. Federal Holidays and saves
- **THEN** reopening the schedule shows the same source, offset, unit, direction and calendar

#### Scenario: No chaining
- **WHEN** a user tries to make a schedule relative to a schedule that is itself relative
- **THEN** that source is not offered and saving such a definition is rejected

### Requirement: One occurrence per source occurrence
Each occurrence of the source schedule SHALL produce exactly one occurrence of the relative schedule, computed from the source's effective date after the source's own move off non-business days.

#### Scenario: Business days counted in the calendar
- **WHEN** "Payday" is monthly on the 15th, moved before non-business days in U.S. Federal Holidays, and "Deposit" is 2 business days before "Payday" in that calendar
- **THEN** Deposit's occurrences include Tuesday, October 13, 2026 (payday Thursday, October 15) and Tuesday, November 10, 2026 (payday Friday, November 13; Wednesday, November 11 is Veterans Day)

#### Scenario: Days with a move off non-business days
- **WHEN** "Card payment" is 21 days after a statement schedule on the 5th, moved after non-business days
- **THEN** the occurrence for the December 5, 2026 statement is Monday, December 28, 2026, because December 26 is a Saturday

#### Scenario: Business days without a calendar
- **WHEN** a relative schedule counts business days with no calendar chosen
- **THEN** only Saturdays and Sundays are skipped while counting

### Requirement: Follows the source pattern
A relative schedule SHALL reflect later changes to the source schedule's date pattern and to the calendars involved, including its stored next date, without editing the relative schedule.

#### Scenario: Source pattern edited
- **WHEN** the source schedule changes from the 15th to the 20th of each month
- **THEN** the relative schedule's next date and upcoming dates move accordingly

### Requirement: Independent progress
Posting or skipping an occurrence of the source SHALL NOT post or skip the relative schedule's occurrence, and posting or skipping the relative schedule SHALL NOT affect the source.

#### Scenario: Skip the source
- **WHEN** a user skips the source schedule's next date
- **THEN** the relative schedule's next date is unchanged

### Requirement: Behaves like any schedule
Relative schedules SHALL have a next date, upcoming dates in the editor, preview transactions, posting, forecasts and budget schedule templates like other schedules, and imported transactions SHALL match them within the usual approximate-date window around their computed dates.

#### Scenario: Imported deposit matches
- **WHEN** a bank import contains the deposit on November 10, 2026 matching the relative schedule's payee and amount
- **THEN** it is linked to the relative schedule's November 10 occurrence

### Requirement: Deleted source is visible
If the source schedule is deleted, its relative schedules SHALL stop producing dates and SHALL show that the source schedule was deleted, in the schedule list and editor, until re-pointed or deleted. Undo of the deletion SHALL restore the source and the relative schedules' dates.

#### Scenario: Source deleted
- **WHEN** a user deletes "Payday" while "Deposit" is relative to it
- **THEN** "Deposit" has no upcoming dates and shows "Source schedule was deleted"

#### Scenario: Undo
- **WHEN** the user undoes that deletion
- **THEN** "Deposit" shows its upcoming dates again

### Requirement: Behind the experimental flag
The relative date option SHALL only be offered in the schedule editor when the business calendars experimental feature is enabled. Existing relative schedules SHALL keep working when the feature is turned off.

#### Scenario: Feature disabled
- **WHEN** the business calendars experimental feature is off
- **THEN** the schedule editor offers only one-time and repeating dates
