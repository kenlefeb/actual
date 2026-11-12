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
The page and Swift SHALL each refuse an invalid write with an error result and no write, before loot-core runs it; Swift builds each write from a typed per-handler value. A write is invalid when its amount is not a finite integer, its month is not a `YYYY-MM` with a budget, or its category id is not a category in that month's snapshot (a group id included). The only exception is the literal `to-budget`, accepted as source or destination of `budget/transfer-category`.

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
The page and Swift SHALL each refuse, with an error result and no write, a transfer with an amount of 0 or less; and a `budget/transfer-category` with the same source and destination, an income category as either end, or (envelope) an amount above the source's balance, where to-budget is limited by the month's to-budget. Refusing a move above the balance is intentional and stricter than the web.

#### Scenario: To-budget as a source or destination
- **GIVEN** an envelope budget with money in to-budget
- **WHEN** native code sends `budget/transfer-category` with `to-budget` as the source or as the destination, and a valid amount
- **THEN** the call is accepted and forwarded, and `to-budget` sent as a category id to `budget/budget-amount` or `budget/transfer-available` is still refused

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
