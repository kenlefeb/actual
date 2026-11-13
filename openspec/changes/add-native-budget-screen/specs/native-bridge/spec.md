# Spec Delta

## Purpose

The write handlers the native Budget screen adds to the `native-bridge` allowlist (sc-3769, sc-3778, sc-3787), how those writes are validated, and the currency fields that `native/budget-month` gains. The base requirements ("The bridge forwards only allowlisted handlers", "A budget month is one batched read") are in the `native-bridge` change; this delta adds to them and does not replace them.

## ADDED Requirements

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
The page and Swift SHALL each refuse, with an error result and no write, a transfer on a month that is not an envelope month, or with an amount of 0 or less; a `budget/transfer-category` with the same source and destination, an income category as either end, `to-budget` as the source, or an amount above the source's balance; and a `budget/transfer-available` for an income category or an amount above the month's to-budget. Refusing a move above the balance is intentional and stricter than the web. A move out of to-budget is always `budget/transfer-available`, because loot-core's `transferCategory` would write a budget row for a category called `to-budget`.

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
- **THEN** the native screen re-reads on that message and shows the month, with no relaunch; a page-load event alone, which fires for any page, does not trigger it

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
