# Spec Delta

## ADDED Requirements

### Requirement: Schedules and paychecks are one batched read
`native/schedules-paychecks` SHALL return, in one message and with no arguments, the following:
- whether paychecks are on;
- the currency;
- a summary (next date, its net pay, the listed schedule count, any warning);
- each paycheck's plan (next date, deposits, skipped and later dates) with its clearing warning;
- the schedules, minus every paycheck's own, each with its status.

#### Scenario: A budget with paychecks
- **GIVEN** a budget with two paychecks and five other schedules
- **WHEN** native code reads `native/schedules-paychecks`
- **THEN** it gets both plans, five schedules with statuses, and a summary, with values equal to the web screens' for that budget

#### Scenario: The shape changes
- **GIVEN** the contract fixtures checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

### Requirement: The schedules and paychecks read meets the latency gate
One `native/schedules-paychecks` round trip SHALL complete in under 50 ms, median and 95th percentile, for a budget with 20 paychecks of 4 deposits each, 200 other schedules and a year of pay transactions. The gate is measured in loot-core on every test run and on the oldest supported iPhone.

#### Scenario: The loot-core benchmark
- **GIVEN** the seeded budget
- **WHEN** the perf test runs repeated reads
- **THEN** it prints the median and the 95th percentile and fails above 50 ms

### Requirement: The paycheck handlers are allowlisted
The allowlist, on the Swift and the page side, SHALL hold the following, and the two lists SHALL stay equal:
- the reads `native/schedules-paychecks`, `native/paycheck-preview` and `paycheck-year-to-date`;
- the writes `native/paycheck-save`, `paycheck-skip-next` and `paycheck-delete`.

Swift SHALL send each write from a typed value, and both sides SHALL refuse an id that is not a paycheck in the last read before loot-core runs it.

#### Scenario: A skip
- **GIVEN** "Acme" is in the last `native/schedules-paychecks` read
- **WHEN** native code calls `paycheck-skip-next` for Acme's id
- **THEN** loot-core skips it and native code receives the result

#### Scenario: An unknown id
- **WHEN** native code calls `paycheck-delete` with an id not in the last read
- **THEN** the call is refused before loot-core receives it

#### Scenario: Other paycheck handlers stay off the list
- **WHEN** native code calls `paycheck-create`, `paycheck-update` or `account-set-business-days`
- **THEN** the call is refused with an error naming the handler

### Requirement: Undo is allowlisted as a call with no arguments
The allowlist SHALL hold `undo`. Swift SHALL send it only through one typed method with no arguments, and only while a screen offers Undo for its own last write; the generic `call` SHALL refuse `undo` in every shape. The page SHALL refuse `undo` with arguments. `redo` SHALL stay off the list.

#### Scenario: Undo after a native write
- **GIVEN** a native skip succeeded and no change event has arrived since
- **WHEN** native code calls its typed undo method
- **THEN** loot-core undoes the skip

#### Scenario: Generic call
- **WHEN** native code calls `call("undo")`
- **THEN** the call is refused, and loot-core never receives it

#### Scenario: No write to undo
- **GIVEN** no Undo is on offer
- **WHEN** native code calls its typed undo method
- **THEN** the method refuses without calling the page

## MODIFIED Requirements

### Requirement: Sync is the only handler outside reads and budget writes
`sync` and `undo` SHALL be the only handlers on the allowlist that are none of the following: a batched read, `query`, a named budget write, or a named paycheck read or write. Every `sync` and `undo` call SHALL still go through the origin-checked path.

#### Scenario: Another handler off the classes
- **GIVEN** the Swift allowlist
- **WHEN** a handler is added that is not a batched read, `query`, a named budget write, a named paycheck read or write, `sync` or `undo`
- **THEN** the allowlist tests fail
