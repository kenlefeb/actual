# Spec Delta

## ADDED Requirements

### Requirement: Saving a schedule picks the same next date as a load

A schedule's next date SHALL never be an occurrence moved to a date before today. When a save needs a new next date (a new schedule, or changed dates or account), it SHALL be the earliest occurrence whose moved date is today or later, the same date the next budget load gives. A save whose dates and account did not change SHALL keep the stored next date.

#### Scenario: Moved back before today

- **GIVEN** today is Sunday, November 15, 2026
- **WHEN** the user creates a monthly schedule on the 15th that moves dates before weekends
- **THEN** its next date is Monday, November 30, 2026, not Friday, November 13, and a budget load leaves it unchanged

#### Scenario: Saved with the same dates

- **GIVEN** a schedule whose next date is December 15, 2026, after its November 30 occurrence was skipped
- **WHEN** the user changes only its name or amount and saves
- **THEN** its next date is still December 15, 2026

#### Scenario: Dates changed, the skipped date still exists

- **GIVEN** a twice-monthly schedule on the 15th and the last day of the month, whose next date is December 15, 2026 after November 30 was skipped
- **WHEN** the user changes it to also stop after December 2027 and saves
- **THEN** its next date is still December 15, 2026

#### Scenario: Dates changed, the skipped date no longer exists

- **GIVEN** the same schedule with next date December 15, 2026
- **WHEN** the user changes it to the 1st and the 20th of each month and saves on November 15, 2026
- **THEN** its next date is Friday, November 20, 2026, the date a load would give
