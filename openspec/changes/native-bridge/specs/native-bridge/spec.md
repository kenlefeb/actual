# Spec Delta

## Purpose

How native Apple screens read from loot-core, which keeps running in the app's WebView. Decision: ADR 11, bridge rules 1 to 5 and data safety.

## ADDED Requirements

### Requirement: The bridge forwards only allowlisted handlers
The native bridge SHALL forward a call to loot-core only when the handler name is on the bridge allowlist. Any other name SHALL be refused before it reaches loot-core, on both the native and the page side. The allowlist SHALL hold only batched read handlers and `query` until a native screen story adds the write handlers it needs.

#### Scenario: An allowlisted read
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `native/budget-month` through the bridge
- **THEN** loot-core runs the handler and native code receives its result

#### Scenario: A name off the list
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `delete-budget` through the bridge
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

### Requirement: A budget month is one batched read
`native/budget-month` SHALL return, in one message, the month, the budget type, every category group and category with its budgeted, spent and balance, and the month totals. Envelope and tracking budgets SHALL share one shape; a value that does not apply to the budget type SHALL be null.

#### Scenario: Envelope budget
- **GIVEN** an envelope budget with income and expense categories
- **WHEN** native code reads a month
- **THEN** it gets every category's budgeted, spent and balance, and the totals include to-budget

#### Scenario: Tracking budget
- **GIVEN** a tracking budget
- **WHEN** native code reads a month
- **THEN** it gets the same shape, with to-budget null and the tracking totals filled in

#### Scenario: The shape changes
- **GIVEN** the contract fixtures checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

### Requirement: Native views re-read on change events
The page SHALL forward `cells-changed` and `sync-event` to native code. Native code SHALL coalesce a burst of events into one re-read of the affected view.

#### Scenario: A write on the web side
- **GIVEN** a native view showing a budget month
- **WHEN** a budget amount changes from the web side
- **THEN** native code receives the change events and re-reads the month once

### Requirement: Only loot-core touches the budget data
Swift code SHALL NOT open the budget database, write CRDT messages or store a computed balance. Every number a native view shows SHALL come from loot-core. A fork check SHALL fail when a Swift source imports `SQLite3`, `sqlite3` or `GRDB`, or names a `.sqlite` path.

#### Scenario: A Swift file imports SQLite
- **GIVEN** a Swift source in the iOS app
- **WHEN** it adds `import SQLite3`
- **THEN** the fork check fails and names the file

### Requirement: A budget month loads within the latency gate
One `native/budget-month` round trip for a 300-category month SHALL complete in under 50 ms on the oldest supported iPhone, measured from the Swift call to the decoded result. If it misses, native screens SHALL NOT start until ADR 11 is revisited.

#### Scenario: The spike benchmark
- **GIVEN** a 300-category budget open in the iOS app
- **WHEN** the benchmark runs repeated round trips
- **THEN** the median and the 95th percentile are recorded on the story and compared with 50 ms
