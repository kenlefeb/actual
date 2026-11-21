## ADDED Requirements

### Requirement: The page forwards when the budget finishes opening
loot-core SHALL send a `budget-opened` event, with no payload, each time it marks a budget open, and never when an open fails. The page SHALL forward it to native code like `cells-changed`. It SHALL NOT change the web client's behavior.

#### Scenario: A slow cold open
- **GIVEN** a native screen whose read was refused with `budget-not-open` during a long open
- **WHEN** the open completes
- **THEN** native code receives `budget-opened`

#### Scenario: A failed open
- **WHEN** a budget fails to open
- **THEN** no `budget-opened` is sent

#### Scenario: A reopen
- **WHEN** a budget is closed and opened again
- **THEN** `budget-opened` is sent again

### Requirement: A native screen that has not loaded re-reads when the budget opens
On `budget-opened`, a native screen that is failed or still loading SHALL re-read once, replacing any read in flight. A screen showing a value SHALL ignore it. A screen in the background SHALL NOT read; its read on returning covers it. A failed re-read SHALL leave the screen failed with Retry until the next event. This holds on the iPhone and the Mac shell.

#### Scenario: Retry state clears itself
- **GIVEN** a native screen showing Retry after a read refused during a slow open
- **WHEN** `budget-opened` arrives
- **THEN** the screen re-reads once and shows its content with no tap on Retry

#### Scenario: Already loaded
- **GIVEN** a loaded native screen
- **WHEN** `budget-opened` arrives
- **THEN** it does not read

#### Scenario: The event during a read
- **GIVEN** a read in flight that then fails with `budget-not-open`
- **WHEN** `budget-opened` arrives first
- **THEN** a new read replaces it and the screen ends loaded

#### Scenario: The re-read fails
- **WHEN** the one re-read fails
- **THEN** the screen stays failed with Retry and reads no more until another event

#### Scenario: The open never completes
- **WHEN** no `budget-opened` ever arrives
- **THEN** the screen keeps its failed state and Retry

### Requirement: A slow open is testable
A test build SHALL be able to delay the open before the budget is marked open, by a build-time number of milliseconds, so a test can show a read made during a slow open ending in a loaded screen. The hook SHALL be compiled out of production builds, and the production-build check and the iPhone Release build phase SHALL refuse a bundle that holds it.

#### Scenario: Production build
- **WHEN** Fork CI checks a production web build
- **THEN** it fails if the slow-open hook's marker is present

#### Scenario: Slow open on the devices
- **GIVEN** a page built with a slow open longer than the open wait
- **WHEN** a native screen reads during the open on the iPhone or the Mac shell
- **THEN** it ends loaded with no tap on Retry
