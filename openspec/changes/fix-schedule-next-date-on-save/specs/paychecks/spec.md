# Spec Delta

## ADDED Requirements

### Requirement: Saving a paycheck keeps its skips

Saving a paycheck whose pay dates did not change SHALL keep the next date of its pay schedule and of each deposit schedule, and so its skips, on desktop, phones and the native apps. When its pay dates change, a skip of an occurrence that still exists SHALL be kept, and skips of occurrences that no longer exist SHALL be dropped.

#### Scenario: Save an unchanged paycheck

- **GIVEN** "Acme" pays on the 15th and the last day of the month, its November 30, 2026 paycheck is skipped, and its next date is December 15, 2026
- **WHEN** the user changes a deduction and saves
- **THEN** its next date is still December 15, 2026, and the list still shows "Skipped: Nov 30"

#### Scenario: Save with a clearing account that has no calendar

- **GIVEN** the same "Acme", whose clearing account and deposit accounts have no business calendar
- **WHEN** the user saves without changing anything
- **THEN** the pay schedule and every deposit schedule keep their next dates

#### Scenario: Change the pay dates

- **GIVEN** the same "Acme" with November 30 skipped
- **WHEN** the user changes its pay dates to the 1st and the 20th of each month and saves on November 15, 2026
- **THEN** the skip is gone, and the next date is the date a budget load gives
