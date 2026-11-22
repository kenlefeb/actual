## ADDED Requirements

### Requirement: Native reads wait for a pending open
While a budget load is in progress, a `native/*` handler that touches the budget SHALL wait for it to finish, then run. If the budget is not open after 4 seconds, or the load fails, the handler SHALL answer `budget-not-open` and read nothing. The wait is set by the requirement "The open wait is a fixed constant". `native/persisted`, `native/storage-state`, `native/enable-storage-guard` and `native/server-info` SHALL never wait.

#### Scenario: A read during a slow open
- **GIVEN** the page's reopen is still loading the budget
- **WHEN** native code reads `native/budget-month`
- **THEN** the read waits and returns the month once the budget is open

#### Scenario: The open takes too long
- **GIVEN** a load that is still running after 4 seconds
- **WHEN** a native read has waited that long
- **THEN** it answers `budget-not-open` and reads nothing

#### Scenario: The open fails
- **GIVEN** a native read waiting on a load
- **WHEN** the load fails
- **THEN** the read answers `budget-not-open` at once

#### Scenario: Handlers that never wait
- **GIVEN** no budget is open
- **WHEN** native code calls `native/enable-storage-guard`
- **THEN** it runs without waiting

### Requirement: Native reads answer at once when no open is pending
When no budget is open and none is loading (first launch with no budget chosen, a budget closed on purpose, a failed open), a gated `native/*` handler SHALL answer `budget-not-open` at once, so a screen is never held by a wait that cannot end. A load marks the budget open when it can serve reads, before any upload step.

#### Scenario: No budget
- **GIVEN** no budget is open and no load is in progress
- **WHEN** native code reads `native/accounts-list`
- **THEN** it answers `budget-not-open` at once

#### Scenario: A slow upload
- **GIVEN** a load whose upload step is slow or fails
- **WHEN** the budget can serve reads
- **THEN** reads run and do not wait for the upload

### Requirement: The open wait is a fixed constant
The 4 second open wait SHALL be a constant, a named exception to the limits rule like the 60 s read deadline: limits are stored in the budget being opened, so none can be read at that moment, and the bridge's read deadline is 5 s. It SHALL stay under that deadline. Story 5269 tracks a device-level setting for every such deadline.

#### Scenario: No setting
- **WHEN** native Settings lists its limits
- **THEN** none of them sets the open wait
