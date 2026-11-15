# Spec Delta

## ADDED Requirements

### Requirement: A save never picks a moved date before today

When a save picks a new next date (a new schedule, or changed dates or account), it SHALL pick the earliest occurrence whose moved date is today or later, never an occurrence moved back before today. A budget load SHALL leave that date unchanged. A save whose dates and account did not change SHALL keep the stored next date.

#### Scenario: Moved back before today

- **GIVEN** today is Sunday, November 15, 2026
- **WHEN** the user creates a monthly schedule on the 15th and the last day of the month that moves dates before weekends
- **THEN** its next date is Monday, November 30, 2026, not Friday, November 13, and a budget load leaves it unchanged

#### Scenario: Saved with the same dates

- **GIVEN** a schedule whose next date is December 15, 2026, after its November 30 occurrence was skipped
- **WHEN** the user changes only its name or amount and saves
- **THEN** its next date is still December 15, 2026

### Requirement: Changing a schedule's dates keeps skips that still exist

When a save changes a schedule's dates, its next date SHALL be the earliest occurrence of the new dates, today or later, that either is not an occurrence of the old dates or is on or after the stored next date. Old occurrences before the stored next date stay skipped. Occurrences the edit added show. Schedules dated relative to it SHALL follow the same rule with their own stored next dates.

#### Scenario: Dates changed, the skipped date still exists

- **GIVEN** a twice-monthly schedule on the 15th and the last day of the month, whose next date is December 15, 2026 after November 30 was skipped
- **WHEN** the user adds an end date of December 2027 and saves
- **THEN** its next date is still December 15, 2026

#### Scenario: Dates changed, the skipped date no longer exists

- **GIVEN** the same schedule with next date December 15, 2026
- **WHEN** the user changes it to the 1st and the 20th of each month and saves on November 15, 2026
- **THEN** its next date is Friday, November 20, 2026

#### Scenario: A pay date added

- **GIVEN** today is Monday, November 16, 2026, and a schedule on the 15th and the last day of the month has next date November 30, 2026, with nothing skipped
- **WHEN** the user adds the 20th and saves
- **THEN** its next date is Friday, November 20, 2026
