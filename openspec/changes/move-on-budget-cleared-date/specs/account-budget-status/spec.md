# Spec Delta

## ADDED Requirements

### Requirement: A cleared or invalid start date
When the start date in the move dialog is empty or is not a real date, the dialog SHALL show no preview numbers and a short hint to choose a start date, and SHALL keep Move disabled. Choosing a valid date SHALL show the preview for it again.

#### Scenario: Clearing the start date
- **GIVEN** the move dialog is open for an off-budget account, on desktop or on a phone, and shows the preview for 2026-10-01
- **WHEN** the user clears the start date
- **THEN** no counts, transfers or starting balance are shown, no sentence is left with a missing date, the hint "Choose a start date" is shown, and Move is disabled

#### Scenario: An impossible start date
- **GIVEN** the move dialog is open
- **WHEN** the user enters 2026-02-31
- **THEN** it behaves as when the date is cleared: no preview numbers, the hint, and Move disabled

#### Scenario: Choosing a date brings the preview back
- **GIVEN** the start date is cleared and the hint is shown
- **WHEN** the user enters 2026-07-01
- **THEN** the preview for 2026-07-01 is shown, the hint is gone, and Move is enabled
