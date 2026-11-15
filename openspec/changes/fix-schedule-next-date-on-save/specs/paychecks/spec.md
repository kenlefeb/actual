# Spec Delta

## ADDED Requirements

### Requirement: Saving a paycheck keeps its skips

Saving a paycheck whose pay dates did not change SHALL keep the next date of its pay schedule and of each deposit schedule, and so its skips, on desktop, phones and the native apps. When its pay dates change, the pay schedule and each deposit schedule SHALL keep skips of occurrences that still exist, and drop skips of occurrences that no longer exist.

#### Scenario: Save an unchanged paycheck

- **GIVEN** "Acme" pays on the 15th and the last day of the month, its November 30, 2026 paycheck is skipped, and its next date is December 15, 2026
- **WHEN** the user changes a deduction and saves
- **THEN** its pay schedule and every deposit schedule keep their next dates, and the list still shows "Skipped: Nov 30"

#### Scenario: Save with a clearing account that has no calendar

- **GIVEN** the same "Acme", whose clearing account and deposit accounts have no business calendar
- **WHEN** the user saves without changing anything
- **THEN** the pay schedule and every deposit schedule keep their next dates

#### Scenario: A pay date added keeps the skip

- **GIVEN** the same "Acme" with November 30 skipped, on Monday, November 16, 2026, and deposits made on the pay date
- **WHEN** the user adds the 8th of each month to its pay dates and saves
- **THEN** the pay schedule's next date and every deposit's next date are Tuesday, December 8, 2026, and November 30 stays skipped for each of them, so no deposit posts for it

#### Scenario: Change the pay dates

- **GIVEN** the same "Acme" with November 30 skipped
- **WHEN** the user changes its pay dates to the 1st and the 20th of each month and saves on November 15, 2026
- **THEN** the skip is gone, and the pay schedule and every deposit have next date Friday, November 20, 2026
