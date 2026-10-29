# Spec Delta

## MODIFIED Requirements

### Requirement: Rule-based holidays
A calendar SHALL support named holiday rules of four kinds: a fixed month and day, the nth (first to fourth) weekday of a month, the last given weekday of a month, and a whole number of days (from -100 to 100) from Western (Gregorian) Easter Sunday. Each rule SHALL produce one holiday per year.

#### Scenario: Fixed date
- **WHEN** a calendar has a fixed-date rule for July 4
- **THEN** July 4 of every year is a holiday in it

#### Scenario: Nth weekday
- **WHEN** a calendar has a rule for the 4th Thursday of November
- **THEN** November 26, 2026 and November 25, 2027 are holidays in it

#### Scenario: Last weekday
- **WHEN** a calendar has a rule for the last Monday of May
- **THEN** May 25, 2026 is a holiday in it

#### Scenario: Good Friday
- **WHEN** a calendar has a rule for 2 days before Easter Sunday
- **THEN** April 3, 2026 and March 26, 2027 are holidays in it

#### Scenario: Easter Monday
- **WHEN** a calendar has a rule for 1 day after Easter Sunday
- **THEN** April 6, 2026 is a holiday in it

#### Scenario: Easter Sunday dates
- **WHEN** Western Easter Sunday is computed
- **THEN** it is March 31, 2024; April 20, 2025; April 5, 2026; April 25, 2038; March 22, 1818; and March 22, 2285

#### Scenario: Easter-relative rule on a non-working weekday
- **WHEN** a rule for Easter Sunday itself uses Saturday-to-Friday, Sunday-to-Monday observance
- **THEN** the following Monday is the non-business day, as for any other Sunday holiday

#### Scenario: Offset out of range
- **WHEN** a user saves an Easter-relative rule whose offset is outside -100 to 100 or not a whole number
- **THEN** the change is rejected with an explanation

## ADDED Requirements

### Requirement: Easter rules in the editor
The desktop calendar editor SHALL let users choose the Easter-relative kind for a holiday rule and set its day offset, and the year preview SHALL show the resulting dates.

#### Scenario: Add Good Friday
- **WHEN** a user changes a holiday rule to "Days from Easter" with offset -2 and previews 2026
- **THEN** the preview lists Friday, April 3, 2026 with the rule's name, and saving stores the rule with kind `easter` and offset -2

#### Scenario: Invalid offset in the editor
- **WHEN** a user enters 150 as the days from Easter
- **THEN** the field keeps showing 150, the editor explains that a whole number from -100 to 100 is needed, and the calendar cannot be saved until it is corrected
