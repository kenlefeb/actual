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
- the writes `native/paycheck-save`, `paycheck-skip-next`, `paycheck-delete` and `native/undo`.

Swift SHALL send each write from a typed value. Before `send`, the page SHALL check each paycheck id against a fresh `paychecks-get`, and each account a save names against the accounts.

#### Scenario: A skip

- **GIVEN** "Acme" is a live paycheck
- **WHEN** native code calls `paycheck-skip-next` for Acme's id
- **THEN** loot-core skips it and native code receives the result

#### Scenario: An unknown id

- **WHEN** native code calls `paycheck-delete` with an id that a fresh `paychecks-get` does not list
- **THEN** the page refuses the call, and loot-core never runs the delete

#### Scenario: Other paycheck handlers stay off the list

- **WHEN** native code calls `paycheck-create`, `paycheck-update`, `account-set-business-days`, `undo` or `redo`
- **THEN** the call is refused with an error naming the handler

### Requirement: Native Undo reverses only the native write it names

Each native paycheck write SHALL record a token that Swift generates as its undo marker's meta. `native/undo({token})` SHALL undo only when the latest undo step's marker carries that token, checked and undone in the same sequential mutator. Otherwise it SHALL refuse and change nothing. Swift SHALL call it only from a user's tap on an offered Undo.

#### Scenario: Undo right after a native skip

- **GIVEN** a native skip with token T succeeded, and nothing undoable ran since
- **WHEN** native code calls `native/undo` with T
- **THEN** loot-core undoes the skip

#### Scenario: Something undoable ran in between

- **GIVEN** a native skip with token T succeeded, and then the web page saved a budget amount
- **WHEN** native code calls `native/undo` with T
- **THEN** it refuses with an error, and neither the skip nor the budget amount is undone

#### Scenario: A made-up token

- **WHEN** the page or native code calls `native/undo` with a token no write recorded
- **THEN** it refuses and changes nothing

## RENAMED Requirements

- FROM: `### Requirement: Sync is the only handler outside reads and budget writes`
- TO: `### Requirement: Sync is the only handler outside reads and named writes`

## MODIFIED Requirements

### Requirement: Sync is the only handler outside reads and named writes

`sync` SHALL be the only handler on the allowlist that is neither a batched read, `query`, a named budget write, nor a named paycheck read or write (`native/undo` among them). The bare `undo` and `redo` handlers SHALL stay off the list. Every `sync` call SHALL still go through the origin-checked path.

#### Scenario: Another handler off the classes

- **GIVEN** the Swift allowlist
- **WHEN** a handler is added that is not a batched read, `query`, a named budget write, a named paycheck read or write, or `sync`
- **THEN** the allowlist tests fail
