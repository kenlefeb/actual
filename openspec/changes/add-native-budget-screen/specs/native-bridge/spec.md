# Spec Delta

## Purpose

The write handlers the native Budget screen adds to the `native-bridge` allowlist (sc-3769, sc-3778, sc-3787). The allowlist's base requirement ("The bridge forwards only allowlisted handlers") is in the `native-bridge` change; this delta adds to it and does not replace it.

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
