# Spec Delta

## MODIFIED Requirements

### Requirement: Relative date definition
A schedule's date SHALL be definable as relative to another schedule: an offset count (zero or more), a unit of days or business days, a direction of before or after, and for business days an optional business calendar. Until a source schedule is chosen, the form SHALL show no error and the preview SHALL be empty; saving without a source SHALL be refused.

#### Scenario: Save a relative schedule
- **WHEN** a user sets a schedule's date to 2 business days before "Payday" in U.S. Federal Holidays and saves
- **THEN** reopening the schedule shows the same source, offset, unit, direction and calendar

#### Scenario: No chaining
- **WHEN** a user tries to make a schedule relative to a schedule that is itself relative
- **THEN** that source is not offered and saving such a definition is rejected

#### Scenario: No error before a source is chosen
- **GIVEN** a schedule's edit form on desktop or on a phone
- **WHEN** the user switches the date to "Relative to another schedule" and has not chosen a source schedule
- **THEN** the form shows no error, including no "Could not search", and the transactions preview is empty

#### Scenario: Choosing a source previews as before
- **GIVEN** the date is relative and has no source chosen
- **WHEN** the user chooses "Payday" as the source
- **THEN** the transactions preview lists the matches for the relative date, as for any completed relative date

#### Scenario: Saving without a source is refused
- **GIVEN** the date is relative and has no source chosen
- **WHEN** the user saves
- **THEN** the save is refused with "Choose the schedule this date is relative to", and no schedule is created or changed
