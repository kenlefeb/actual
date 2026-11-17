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

### Requirement: The reconcile handlers are allowlisted
The bridge allowlist SHALL add `native/reconcile-month`, `native/reconcile-rows`, `native/reconcile-tick`, `native/reconcile-list-set`, `account-statement-balance-prefill`, `account-statement-balance-save` and `account-statement-balance-get`, and the native chrome SHALL accept a `presentReconcile` message only from the app's own page and only for an `account_id` that is a known open account. No other handler SHALL join the list.

#### Scenario: An allowlisted reconcile read
- **WHEN** native code calls `native/reconcile-month`
- **THEN** loot-core runs it and native receives the checklist

#### Scenario: An unknown account id
- **WHEN** the page posts `presentReconcile` with an id that is not a known open account, or is not a string
- **THEN** native ignores it and loads nothing

#### Scenario: A message from another page
- **WHEN** a frame outside the app's origin posts `presentReconcile`
- **THEN** it is ignored

### Requirement: The step 3 and 4 handlers are allowlisted and native only
The bridge allowlist SHALL add `native/reconcile-matches`, `native/reconcile-lock-preview`, `native/reconcile-adjust` and `native/reconcile-lock`, and `native/reconcile-rows` SHALL accept a `search` argument. No `api/` handler SHALL expose the native lock or the adjustment.

#### Scenario: An allowlisted lock preview
- **WHEN** native code calls `native/reconcile-lock-preview`
- **THEN** loot-core returns the rows, partners and digest

#### Scenario: The API
- **WHEN** the API's handlers are listed
- **THEN** none exposes the native lock or adjustment

### Requirement: The native Budget screen's write handlers are allowlisted
The bridge allowlist, on the Swift and the page side, SHALL also hold `budget/budget-amount`, `budget/transfer-category` and `budget/transfer-available`, and no other write handler. Loot-core, not native code, SHALL choose the envelope or tracking table. An amount SHALL cross the bridge as an integer in minor units, and the two lists SHALL stay equal.

#### Scenario: Setting a budgeted amount
- **GIVEN** the iOS app with an envelope budget open
- **WHEN** native code calls `budget/budget-amount` with a category, a month and an amount
- **THEN** loot-core runs the handler, and the next `native/budget-month` read shows that amount as the category's budgeted value

#### Scenario: Setting a budgeted amount on a tracking budget
- **GIVEN** the iOS app with a tracking budget open
- **WHEN** native code calls `budget/budget-amount` with a category, a month and an amount
- **THEN** loot-core stores it as a tracking budget amount, and the next read shows it, with no other handler name used

#### Scenario: Moving money
- **GIVEN** the iOS app with an envelope budget open
- **WHEN** native code calls `budget/transfer-category` to move an amount between two categories, or from a category to to-budget, or `budget/transfer-available` to move an amount from to-budget into a category
- **THEN** loot-core runs the handler, and the next read shows the amounts moved

#### Scenario: A write name off the list
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `budget/set-zero`, `budget/cover-overspending` or any other write handler that is not on the allowlist
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: The lists differ
- **GIVEN** the Swift allowlist and `native-bridge-allowlist.json`
- **WHEN** one lists a handler the other does not
- **THEN** the allowlist tests on both sides fail

### Requirement: A budget month carries the budget's currency
`native/budget-month` SHALL also return the budget's currency code, decimal places and symbol, and the web's formatting preferences (`numberFormat`, `hideFraction`, `currencySymbolPosition`, `currencySpaceBetweenAmountAndSymbol`), resolved as the web's `useFormat` does. An unknown code or invalid preference SHALL fall back to the web's default (no currency, `comma-dot`, symbol before). These are additive fields of the existing shape.

#### Scenario: A budget with a currency
- **GIVEN** a budget whose currency is set
- **WHEN** native code reads a month
- **THEN** the result carries that currency's code and decimal places

#### Scenario: A budget with no currency set
- **GIVEN** a budget with no `defaultCurrencyCode` preference
- **WHEN** native code reads a month
- **THEN** the result carries the same default the web screen formats with

#### Scenario: The shape changes
- **GIVEN** the contract fixtures checked by vitest and decoded by the Swift tests
- **WHEN** the currency fields are added
- **THEN** both the vitest contract test and the Swift decode test pass against the regenerated fixture, and fail against the old one

### Requirement: Native code formats amounts from the budget month
Native code SHALL format amounts, turn typed input into minor units, and fill `currencyCode` for `budget/transfer-category` from the currency and formatting fields of `native/budget-month`, never from the device locale or a constant.

#### Scenario: Formatting ignores the device locale
- **WHEN** the device locale uses a different number format from the budget's `numberFormat`
- **THEN** the native screen shows amounts in the budget's format, the same as the web screen

### Requirement: Bridge writes are validated before loot-core runs them
The page and Swift SHALL each refuse an invalid write with an error result and no write, before loot-core runs it; Swift builds each write from a typed per-handler value. A write is invalid when its amount is not a finite integer, its month is not a `YYYY-MM` with a budget, or its category id is not a category in that month's snapshot (a group id included). The only exception is the literal `to-budget`, accepted as the destination of `budget/transfer-category`.

#### Scenario: Amount is not an integer
- **GIVEN** the iOS app with a budget open
- **WHEN** native code sends `budget/budget-amount` with an amount of 12.5, a text, null, or no amount
- **THEN** the call returns an error and nothing is written, and the category's budgeted value is unchanged

#### Scenario: Amount is not finite
- **GIVEN** the iOS app with a budget open
- **WHEN** native code sends an amount of NaN or infinity
- **THEN** the call returns an error and nothing is written

#### Scenario: Month is malformed
- **GIVEN** the iOS app with a budget open
- **WHEN** native code sends a month of `2026-13`, `2026-1` or `abc`
- **THEN** the call returns an error and no row is written

#### Scenario: Month is outside the budget
- **GIVEN** a budget that starts in 2024-03
- **WHEN** native code sends a write for `2020-01`
- **THEN** the call returns an error and no row is written

#### Scenario: Unknown category
- **GIVEN** the iOS app with a budget open
- **WHEN** native code sends a write for an id that is not in the month's snapshot
- **THEN** the call returns an error and no orphan budget row is created

#### Scenario: A group id
- **GIVEN** the iOS app with a budget open
- **WHEN** native code sends a write whose category is a category group's id
- **THEN** the call returns an error and nothing is written

#### Scenario: Swift refuses first
- **GIVEN** a typed Swift write value with an invalid amount, month or id
- **WHEN** native code tries to call
- **THEN** Swift refuses it before the call, without reaching the page

### Requirement: Transfers follow the move-money rules
The page and Swift SHALL each refuse, with an error result and no write, a transfer that breaks the move-money rules: an envelope month only, an amount above 0 and no more than the source holds, two different ends, no income category at either end, and `to-budget` only as a destination of `budget/transfer-category`. Refusing a move above the balance is intentional and stricter than the web.

#### Scenario: A month that is not an envelope month
- **GIVEN** a tracking budget
- **WHEN** native code sends `budget/transfer-category` or `budget/transfer-available` with a valid amount
- **THEN** the call returns an error and nothing is written

#### Scenario: Moving out of to-budget
- **GIVEN** an envelope budget with money in to-budget
- **WHEN** native code moves money from to-budget into a category
- **THEN** it uses `budget/transfer-available`, and a `budget/transfer-category` with `to-budget` as the source returns an error and writes nothing, because loot-core's `transferCategory` would write a budget row for a category called `to-budget`

#### Scenario: Moving more than to-budget holds
- **GIVEN** an envelope month whose to-budget is 5000
- **WHEN** native code sends `budget/transfer-available` for 5001, or for an income category
- **THEN** the call returns an error and nothing is written

#### Scenario: To-budget as the destination
- **GIVEN** an envelope budget
- **WHEN** native code sends `budget/transfer-category` with `to-budget` as the destination, and a valid amount
- **THEN** the call is accepted and forwarded, and `to-budget` sent as the source of `budget/transfer-category`, or as a category id to `budget/budget-amount` or `budget/transfer-available`, is refused

#### Scenario: Transfer to itself
- **GIVEN** an envelope budget
- **WHEN** native code sends `budget/transfer-category` with the same source and destination
- **THEN** the call returns an error and nothing is written

#### Scenario: Transfer of zero or a negative amount
- **GIVEN** an envelope budget
- **WHEN** native code sends `budget/transfer-category` or `budget/transfer-available` with an amount of 0 or less
- **THEN** the call returns an error and nothing is written

#### Scenario: Transfer of more than the source holds
- **GIVEN** an envelope budget whose source category has a balance of 5000
- **WHEN** native code sends `budget/transfer-category` for 5001 from it
- **THEN** the call returns an error and nothing is written

#### Scenario: Income category as an end
- **GIVEN** an envelope budget
- **WHEN** native code sends `budget/transfer-category` with an income category as source or destination
- **THEN** the call returns an error and nothing is written

### Requirement: Budgeted income is editable only on tracking months
The page and Swift SHALL each refuse a `budget/budget-amount` for an income category, with an error result and no write, unless the month snapshot's `budgetType` is `tracking`, where income categories hold budgeted amounts. Both SHALL apply the same rule, and a group id SHALL stay refused in both modes.

#### Scenario: Income category on a tracking month
- **GIVEN** a tracking month whose snapshot has an income category
- **WHEN** native code sends `budget/budget-amount` for it
- **THEN** Swift and the page each accept it and loot-core stores the amount

#### Scenario: Income category on an envelope month
- **GIVEN** an envelope month whose snapshot has an income category
- **WHEN** native code sends `budget/budget-amount` for it
- **THEN** Swift and the page each refuse it, and nothing is written

### Requirement: The origin guard covers the write names
The page-origin guard of the bridge (sc-3697) SHALL apply to the write handler names exactly as to the reads: a call to `budget/budget-amount`, `budget/transfer-category` or `budget/transfer-available` posted from a frame that is not the app's main frame, or from a page on another scheme, host or port, SHALL be ignored and SHALL NOT reach loot-core.

#### Scenario: A write from another frame
- **GIVEN** a frame, or a page on another host, is loaded in the web view
- **WHEN** it posts a bridge call to `budget/budget-amount`, `budget/transfer-category` or `budget/transfer-available`
- **THEN** the native side ignores it, and no budget amount changes

#### Scenario: A write from the app's own page
- **GIVEN** the app's page in the main frame from the app server
- **WHEN** it posts a valid write for an allowlisted handler
- **THEN** the native side acts on it

### Requirement: Swift calls into the page only while it is the app's own page
Before every call into the page, read or write, bridge or native chrome, Swift SHALL check that the main frame URL has the app server's scheme, host and port, with default ports normalized, through one shared checked path. Every call SHALL target the main frame (no `WKFrameInfo`) in the page content world. If the check fails, or the main frame has no URL, the call SHALL fail closed: it returns an error, and no handler name or argument reaches the page.

#### Scenario: A write while a foreign page is loaded
- **GIVEN** the web view's main frame shows a page on another host, such as a sign-in page
- **WHEN** native code calls `budget/budget-amount`, `budget/transfer-category` or `budget/transfer-available`
- **THEN** the call returns the origin error, the page is never called and receives no arguments, and no budget amount changes

#### Scenario: A read while a foreign page is loaded
- **GIVEN** the web view's main frame shows a page on another host
- **WHEN** native code calls `native/budget-month` or `query`
- **THEN** the call returns the origin error without calling the page, and the screen shows its error state with the last good numbers, not data from that page

#### Scenario: The web app served from the sync server
- **GIVEN** the main frame shows the Actual web app from the sync server host, which has its own `__actualNativeBridge`
- **WHEN** native code calls `native/budget-month` or a write
- **THEN** the call returns the origin error and that page's bridge is never called

#### Scenario: Same host on another scheme or port
- **GIVEN** the main frame shows a page on the app server's host but on another scheme or port
- **WHEN** native code makes any bridge call
- **THEN** the call returns the origin error and the page is never called

#### Scenario: No page loaded
- **GIVEN** the main frame has no URL, or shows `about:blank`
- **WHEN** native code makes any bridge call
- **THEN** the call returns the origin error and the page is never called

#### Scenario: A tab-bar tap while a foreign page is loaded
- **GIVEN** the main frame shows a page on another host, such as a sign-in page
- **WHEN** the user taps a tab, so the native tab bar asks the page to navigate to a route
- **THEN** the page is never called and receives no route, and the tap is dropped, not queued to fire after the app's page returns

#### Scenario: The app's own page
- **GIVEN** the app's page in the main frame from the app server
- **WHEN** native code calls `native/budget-month` or a valid allowlisted write
- **THEN** the call reaches the page and returns loot-core's result, as before

#### Scenario: Back on the app's own page
- **GIVEN** native calls were refused while a sign-in page was in the main frame
- **WHEN** the app's own page is back in the main frame, and its page bridge reports that it is ready through a message that passes the inbound origin guard
- **THEN** the native screen re-reads on that message unless it is already showing a plain loaded month, so a refused, failed or stale screen refreshes, and shows the month, with no relaunch; a page-load event alone, which fires for any page, does not trigger it

#### Scenario: A ready message when nothing failed
- **GIVEN** a loaded month that has no stale mark
- **WHEN** the page bridge's ready message passes the inbound origin guard
- **THEN** the screen makes no read; with no month loaded yet (a cold start), the message still loads it

### Requirement: The expected origin comes from the server URL
Swift SHALL derive the expected origin from the same server URL `PageOriginGuard` uses, in the form `location.origin` serializes: lowercased scheme and host, with the default port omitted (for example `capacitor://localhost`, `http://localhost:3001`, `https://host`). It SHALL pass it to the page script as a string argument that is not named `location` or `window`.

#### Scenario: The production config
- **GIVEN** the app built with no `server.url`, so the server URL is `capacitor://localhost`
- **WHEN** the app's page is in the main frame and native code makes a bridge call
- **THEN** the expected origin is `capacitor://localhost`, both checks pass, and the call reaches the page

#### Scenario: A dev config
- **GIVEN** the app built with a dev `server.url` such as `http://localhost:3001`
- **WHEN** the app's page from that server is in the main frame and native code makes a bridge call
- **THEN** the expected origin is `http://localhost:3001`, both checks pass, and the call reaches the page

#### Scenario: A default port written out
- **GIVEN** a server URL of `https://host:443`
- **WHEN** the app's page from `https://host` is in the main frame
- **THEN** the expected origin is `https://host`, and the call is not refused

### Requirement: The origin is checked again where the call runs
The script Swift runs in the page SHALL first compare `location.origin` with the expected origin using only `!==` on strings. It SHALL use no page-defined function, constructor or prototype before or during the check, and on a mismatch SHALL return a fixed primitive sentinel, before it reads the arguments or touches any other page object. This covers a navigation that commits between the two checks.

#### Scenario: The page navigates between the two checks
- **GIVEN** Swift's check passed, and the main frame then commits a page on another host before the script runs
- **WHEN** the script runs in that page
- **THEN** it returns the sentinel without reading the arguments or calling any page function, and the call returns the origin error

#### Scenario: A foreign page replaces page globals
- **GIVEN** a foreign page in the main frame that has replaced `Error`, `JSON.parse` and `window.__actualNativeBridge`
- **WHEN** the script runs in it
- **THEN** none of them is called, and the script returns the sentinel

### Requirement: Swift trusts only a confirmed result
After the check passes, the script SHALL return a fixed-shape value it builds itself (e.g. `{ confirmed: true, value }`, with bridge errors caught and returned inside it). Swift SHALL treat a call as confirmed only on that shape; the sentinel, any exception and any other result are unconfirmed and map to the origin error.

#### Scenario: A confirmed call
- **GIVEN** the app's own page in the main frame
- **WHEN** the script's check passes and loot-core returns a result, or the bridge refuses the call
- **THEN** the script returns the confirmed shape carrying that result or that bridge error, and Swift returns it as before

#### Scenario: An unconfirmed result
- **GIVEN** a call whose script returned the sentinel, threw, or returned any value without the confirmed shape
- **WHEN** Swift receives it
- **THEN** the call returns the origin error, and none of that value is returned or logged

### Requirement: An origin refusal reveals nothing about the foreign page
The origin error SHALL be one fixed error. Swift SHALL map the sentinel, and any JavaScript exception from a call whose in-page check did not confirm the origin, to that error, and SHALL never log or return the exception's message, source URL or `userInfo`. Neither the error nor its log line SHALL contain any part of the foreign page's URL, host, path, query or title.

#### Scenario: A refused call's error
- **GIVEN** the main frame shows `https://login.example.com/authorize?state=abc`
- **WHEN** a bridge call is refused
- **THEN** the error and its log line are the same as for any other foreign page, and contain neither `login.example.com` nor `state=abc`

#### Scenario: A foreign page throws its own value
- **GIVEN** a call whose in-page check did not confirm the origin, in a page that throws a string containing its URL
- **WHEN** Swift receives the exception
- **THEN** the call returns the fixed origin error, and the URL appears in neither the error nor any log line

### Requirement: Injected page scripts act only on the app's own page
Every `WKUserScript` the app injects SHALL do nothing unless `location.origin` equals the expected origin, compared with `===` or `!==` only and using no page-defined function. `NativeScreensScript` SHALL therefore set `window.__actualNativeScreens` only on the app's own page.

#### Scenario: A sign-in page loads
- **GIVEN** the native screens script is installed
- **WHEN** a sign-in page on another host loads in the main frame
- **THEN** that page gets no `__actualNativeScreens`

#### Scenario: The app's page loads
- **GIVEN** the native screens script is installed
- **WHEN** the app's page loads in the main frame
- **THEN** `__actualNativeScreens` holds the current switch values, as before

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
