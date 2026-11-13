# native-bridge Specification

## Purpose
How native Apple screens read from loot-core, which keeps running in the app's WebView. Decision: ADR 11, bridge rules 1 to 5 and data safety.

## Requirements

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

### Requirement: The bridge accepts messages only from the app's own page
The native side SHALL act on a message from the page only when it comes from the main frame and from the app server's scheme, host and port. Sign-in pages and other frames load in the same web view, so every message handler (the bridge and the native chrome) SHALL apply this check and ignore anything else.

#### Scenario: A message from the app's page
- **GIVEN** the app's page is loaded in the main frame from the app server
- **WHEN** it posts a bridge or chrome message
- **THEN** the native side acts on it

#### Scenario: A message from another frame or origin
- **GIVEN** a frame, or a page on another host, scheme or port, is loaded in the web view
- **WHEN** it posts a bridge or chrome message
- **THEN** the native side ignores it

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

### Requirement: Sync is allowlisted as a call with no arguments
The bridge allowlist, on the Swift and the page side, SHALL also hold `sync`, loot-core's existing sync handler, and the two lists SHALL stay equal. Swift SHALL send it only through one typed method that passes no arguments, and the generic `call` SHALL refuse the name `sync` in every shape, including with no arguments, so the result is always decoded and the 30 second deadline always applies.

#### Scenario: A sync call
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `sync` through its typed method
- **THEN** loot-core runs its sync handler and native code receives the reduced result

#### Scenario: The generic call with no arguments
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `call("sync")` with no arguments
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: Sync with arguments
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `sync` with any argument
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: Bank sync is not allowlisted
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `simplefin-batch-sync`, `accounts-bank-sync` or any other bank sync handler
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: The lists differ
- **GIVEN** the Swift allowlist and `native-bridge-allowlist.json`
- **WHEN** one lists `sync` and the other does not
- **THEN** the allowlist tests on both sides fail

#### Scenario: A foreign page
- **GIVEN** the main frame shows a page on another host
- **WHEN** native code calls `sync`
- **THEN** the call returns the fixed origin error, and the page receives nothing

### Requirement: Sync is the only handler outside reads and budget writes
`sync` SHALL be the only handler on the allowlist that is neither a batched read, `query`, nor one of the named budget writes. Every `sync` call SHALL still go through the origin-checked path.

#### Scenario: Another handler off the classes
- **GIVEN** the Swift allowlist
- **WHEN** a handler is added that is not a batched read, `query`, a named budget write or `sync`
- **THEN** the allowlist tests fail

### Requirement: The page returns only whether the sync worked and why not
The page bridge SHALL return `{"ok": true}` when loot-core's sync returns no error, and `{"ok": false, "reason": R}` when it does. R SHALL be one of `network`, `unauthorized`, `out-of-sync`, `clock-drift`, `encryption` or `other`. The page SHALL build this shape itself, and loot-core's `messages`, `message` and `meta` SHALL NOT cross the bridge.

#### Scenario: A sync that works
- **GIVEN** a budget with a sync server and a change made on another device
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": true}` and carries no messages

#### Scenario: The shape changes
- **GIVEN** the contract fixtures checked by vitest and decoded by the Swift tests
- **WHEN** the result shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

### Requirement: The page calls sync with no arguments and survives a rejection
The page SHALL call `send('sync')` with no arguments, whatever it was given. A rejection of `send('sync')` SHALL return `{"ok": false, "reason": "other"}`, never the rejection's message.

#### Scenario: A rejection that carries the server address
- **GIVEN** `send('sync')` rejects with a message containing `https://sync.example.com/sync/sync`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": "other"}` and the address appears nowhere in it

#### Scenario: Arguments are not forwarded
- **GIVEN** the page bridge
- **WHEN** it is called for `sync` with any arguments
- **THEN** it calls `send('sync')` with none

### Requirement: Sync failure reasons map to a closed set
The page SHALL map loot-core's reason as follows: `network-failure` to `network`; `unauthorized`, `out-of-sync` and `clock-drift` to themselves; `encrypt-failure` and `decrypt-failure` to `encryption`; every other reason, including an unknown one, to `other`. Swift SHALL decode R into a closed set and treat any other value as `other`.

#### Scenario: Each failure
- **GIVEN** loot-core's sync fails with reason `network-failure`, `unauthorized`, `out-of-sync`, `clock-drift`, `encrypt-failure`, `decrypt-failure` or `invalid-schema`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": R}` with `network`, `unauthorized`, `out-of-sync`, `clock-drift`, `encryption`, `encryption` or `other`, in that order

#### Scenario: An unknown reason
- **GIVEN** loot-core's sync fails with a reason not listed above, or the page returns a reason Swift does not know
- **WHEN** native code receives the result
- **THEN** the reason is `other`

### Requirement: A sync error reveals nothing about the server
No part of a failed sync's call result SHALL reach native code, a log line or the screen except R. The page SHALL drop the error's `message` and `meta`, which can carry the server address, an HTTP status or a response body. No credential, token or file id SHALL cross the bridge in either direction. The `sync-event` the page forwards still carries loot-core's payload, including `meta`; Swift SHALL read only the event name and SHALL NOT read, store or log the payload.

#### Scenario: A failure that carries the server address
- **GIVEN** loot-core's sync fails with a `message` and `meta` that contain `https://sync.example.com/sync/sync` and a response body
- **WHEN** native code calls `sync`
- **THEN** the result is the reduced shape only, and neither the address nor the body appears in the result, in any log line or on the screen

#### Scenario: The sync-event payload
- **GIVEN** a failed sync emits `sync-event` with a `meta` holding an error message and stack
- **WHEN** native code receives the event
- **THEN** it reads only the event name, and the payload is stored and logged nowhere

#### Scenario: Read-only mode after unauthorized
- **GIVEN** loot-core's sync fails with `unauthorized`, which puts it into read-only mode
- **WHEN** native code receives `{"ok": false, "reason": "unauthorized"}`
- **THEN** native code changes nothing about that mode, which is loot-core's existing behaviour

### Requirement: A sync call has its own 30 second deadline
Every bridge call SHALL keep the 5 second default deadline, except `sync`, which SHALL have a deadline of 30 seconds, set per call. When it passes, the call SHALL fail with the timeout error naming the handler. The deadline SHALL stop only the wait: loot-core SHALL keep syncing, and native code SHALL NOT retry the call.

#### Scenario: A slow sync
- **GIVEN** a sync that takes 12 seconds
- **WHEN** native code calls `sync`
- **THEN** the call returns the result after 12 seconds, without a timeout error

#### Scenario: A sync that outlasts the deadline
- **GIVEN** a sync, or a suspended engine, that does not answer
- **WHEN** native code calls `sync`
- **THEN** the call fails with the timeout error after 30 seconds, and loot-core is not told to stop

#### Scenario: Other calls keep their deadline
- **GIVEN** the 30 second deadline for `sync`
- **WHEN** native code calls `native/budget-month` and the engine does not answer
- **THEN** that call fails with the timeout error after about 5 seconds
