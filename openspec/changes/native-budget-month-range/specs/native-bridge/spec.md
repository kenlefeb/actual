# Spec Delta

## Purpose

The month range that `native/budget-month` reports (sc-3850), so a native screen knows the budget's first and last month without trying to step past them. The base requirements ("A budget month is one batched read", "A budget month carries the budget's currency") are in the `native-bridge` and `add-native-budget-screen` changes; this delta adds to them and does not replace them.

## ADDED Requirements

### Requirement: A budget month reports the budget's month range
`native/budget-month` SHALL also return `firstMonth` and `lastMonth`, the earliest and latest month the budget has, as `YYYY-MM` strings. The visible `month` SHALL lie between them, and every month between them SHALL be readable. They are additive fields of the existing shape.

#### Scenario: A budget with several months
- **GIVEN** a budget whose months run from 2026-02 to 2026-07
- **WHEN** native code reads 2026-04
- **THEN** the result has `month` "2026-04", `firstMonth` "2026-02" and `lastMonth` "2026-07"

#### Scenario: The same range from any month
- **GIVEN** the same budget
- **WHEN** native code reads 2026-02, then 2026-07
- **THEN** both results carry `firstMonth` "2026-02" and `lastMonth` "2026-07"

#### Scenario: Envelope and tracking
- **GIVEN** an envelope budget and a tracking budget
- **WHEN** native code reads a month of each
- **THEN** both results carry the two fields in the same shape

### Requirement: Reading the range creates nothing
The range SHALL come from the months loot-core already has. `native/budget-month` SHALL NOT create a budget month, SHALL NOT call `get-budget-bounds`, and SHALL NOT change any data, and `get-budget-bounds` SHALL NOT join the bridge allowlist.

#### Scenario: A read leaves the months as they were
- **GIVEN** a budget with a set of months
- **WHEN** native code reads a month several times
- **THEN** the set of months is unchanged and no write reaches the database

#### Scenario: Months the web adds later
- **GIVEN** native code has read a month, and the web then budgets two months beyond the old last month
- **WHEN** native code reads again
- **THEN** `lastMonth` is the new last month

#### Scenario: A month outside the range
- **GIVEN** a budget whose last month is 2026-07
- **WHEN** native code reads 2026-08
- **THEN** it gets the "no budget for month" error as before, and no month is created
