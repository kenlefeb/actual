# Spec Delta

## Purpose

How native Apple screens read from loot-core, which keeps running in the app's WebView. Decision: ADR 11, bridge rules 1 to 5 and data safety.

## ADDED Requirements

### Requirement: The bridge forwards only allowlisted handlers
The native bridge SHALL forward a call to loot-core only when the handler name is on the bridge allowlist. The native side SHALL refuse any other name before it reaches the page; that check is the security boundary. The page SHALL refuse it too, to catch mistakes. The allowlist SHALL hold only batched read handlers and `query` until a native screen story adds the write handlers it needs.

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
The page SHALL forward `cells-changed` and `sync-event` to native code. Native code SHALL coalesce events into at most one re-read of the affected view per frame.

#### Scenario: A write on the web side
- **GIVEN** a native view showing a budget month
- **WHEN** several budget amounts change from the web side at once
- **THEN** native code receives the change events and re-reads the month at most once per frame, not once per event

### Requirement: Only loot-core touches the budget data
Native code SHALL NOT open the budget database, write CRDT messages or store a computed balance. Every number a native view shows SHALL come from loot-core. A fork check SHALL fail when a Swift, header or Objective-C source imports or checks for a database library (`SQLite3`, `sqlite3`, `SQLite`, `CSQLite`, `SQLCipher`, `GRDB`, `FMDB` or `CoreData`), includes `sqlite3.h`, or names a `.sqlite` or `.sqlite3` path.

#### Scenario: A Swift file imports SQLite
- **GIVEN** a Swift source in the iOS app
- **WHEN** it adds `import SQLite3`, `import struct SQLite3.sqlite3` or `#if canImport(SQLite3)`
- **THEN** the fork check fails and names the file

#### Scenario: A bridging header includes SQLite
- **GIVEN** the iOS app's bridging header
- **WHEN** it adds `#import <sqlite3.h>`
- **THEN** the fork check fails and names the header

### Requirement: App extensions never start their own engine
An app extension, such as a widget or an App Intent, SHALL NOT start a WebView or loot-core. It SHALL read a snapshot the host app writes to the App Group, or call through the host app. Only the host app's bridge view controller SHALL register the bridge plugin, so an extension has no bridge to reach.

#### Scenario: A widget shows a budget number
- **GIVEN** a budget widget on the Home Screen
- **WHEN** it refreshes
- **THEN** it reads the App Group snapshot the app last wrote, and starts no WebView or engine

#### Scenario: An App Intent records a change
- **GIVEN** an App Intent that changes the budget
- **WHEN** it runs
- **THEN** it hands the change to the host app, which writes it through loot-core, and the intent starts no engine of its own

### Requirement: Native views survive a suspended engine
iOS suspends the WebView's engine while the app is in the background, and a bridge call made then hangs until the app returns. Every bridge call SHALL have a timeout, about 5 seconds by default, after which it fails with a timeout error. Native screens SHALL NOT read through the bridge while the app is in the background, and SHALL re-read the visible view when the app returns to the foreground.

#### Scenario: A call while the engine is suspended
- **GIVEN** the engine is suspended and does not answer
- **WHEN** native code calls `native/budget-month`
- **THEN** the call fails with a timeout error naming the handler after the timeout, instead of hanging

#### Scenario: Back to the foreground
- **GIVEN** a native budget screen open when the app went to the background
- **WHEN** the app returns to the foreground
- **THEN** the screen re-reads the month through the bridge, without having read while in the background

### Requirement: A budget month loads within the latency gate
One `native/budget-month` round trip for a 300-category month SHALL complete in under 50 ms on the oldest supported iPhone, measured from the Swift call to the decoded result. If it misses, native screens SHALL NOT start until ADR 11 is revisited.

#### Scenario: The spike benchmark
- **GIVEN** a 300-category budget open in the iOS app
- **WHEN** the benchmark runs repeated round trips
- **THEN** the median and the 95th percentile are recorded on the story and compared with 50 ms

#### Scenario: Ken runs the benchmark from TestFlight
- **GIVEN** the TestFlight build on Ken's iPhone with a budget open
- **WHEN** he holds two fingers on the screen for 3 seconds and confirms
- **THEN** the app times read-only `native/budget-month` reads of the current month, shows the median and the 95th percentile on screen, and offers to share them

#### Scenario: The benchmark never runs by itself
- **GIVEN** the iOS app
- **WHEN** it launches, opens a link, or the user holds two fingers without confirming
- **THEN** no benchmark runs and nothing in the budget changes
