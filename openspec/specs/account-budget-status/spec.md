# account-budget-status Specification

## Purpose
Defines how moving an account on budget keeps its pre-move history out of the uncategorized count and lists, and asks before that history is categorized, so the move does not double count spending.

## Requirements

### Requirement: The move remembers its start date
Moving an account on budget SHALL record the account's start date and its offset line with the account, in the same undoable step. Undo SHALL clear them, and other devices SHALL have them after they sync.

#### Scenario: Recorded with the account
- **GIVEN** an off-budget account "Vanguard"
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** "Vanguard" records the start date 2026-10-01 and its offset line

#### Scenario: Undo clears them
- **GIVEN** the user has just moved "Vanguard" on budget
- **WHEN** the user undoes
- **THEN** "Vanguard" records no start date and no offset line

### Requirement: Moved history isn't uncategorized
A moved account's transactions dated before its start date, and its offset line, SHALL NOT count toward the uncategorized count or appear in the uncategorized lists, on desktop or phones. They SHALL show "Moved history" instead of the "Categorize" prompt. Transactions from the start date on that have no category SHALL still count and be prompted.

#### Scenario: The count is unchanged by the move
- **GIVEN** a budget whose uncategorized count is 3, and an off-budget account with 20 transactions before 2026-10-01 and none after
- **WHEN** the user moves the account on budget with a start date of 2026-10-01
- **THEN** the uncategorized count is still 3, and neither the 20 transactions nor the offset line is in the uncategorized list

#### Scenario: A never-moved account keeps its count
- **GIVEN** an on-budget account "Checking" that was never moved, with 2 transactions without a category
- **WHEN** another account is moved on budget
- **THEN** both "Checking" transactions are still counted and listed as uncategorized

#### Scenario: Later transactions still count
- **GIVEN** the moved account has a transaction on 2026-10-05 with no category
- **WHEN** the user views the uncategorized count and list
- **THEN** that transaction is counted and listed, and its category cell says "Categorize"

#### Scenario: Moved history reads as moved history
- **GIVEN** the moved account's transaction on 2026-09-15 and its offset line
- **WHEN** the user views the account's register on desktop or a phone
- **THEN** both show "Moved history" where an uncategorized transaction shows "Categorize" or "Uncategorized"

#### Scenario: Undo restores the count
- **GIVEN** the uncategorized count was 3 before the move and is 3 after it
- **WHEN** the user undoes the move
- **THEN** the account is off budget again, and the count is 3

#### Scenario: Another device
- **GIVEN** two devices share a synced budget
- **WHEN** one device moves an account on budget and both sync
- **THEN** both devices show the same uncategorized count, without the moved history

### Requirement: Categorizing moved history asks first
Choosing a category for a moved account's transaction dated before its start date, or for its offset line, SHALL first show a confirmation that explains the double count. Cancel SHALL leave the transaction uncategorized. When the user sets a category on several selected transactions at once and any of them is moved history, the app SHALL show one confirmation for the batch, and Cancel SHALL change none of them.

#### Scenario: Cancel
- **GIVEN** the moved account's offset line
- **WHEN** the user chooses "Groceries" for it and cancels the confirmation
- **THEN** the offset line has no category

#### Scenario: Categorize anyway
- **GIVEN** the moved account's transaction on 2026-09-15
- **WHEN** the user chooses "Groceries" for it and confirms
- **THEN** it has the category "Groceries"

#### Scenario: Bulk categorize includes moved history
- **GIVEN** the user selects the moved account's transaction on 2026-09-15 and its transaction on 2026-10-05
- **WHEN** they set "Groceries" on both and cancel the confirmation
- **THEN** neither changes
- **AND WHEN** they set "Groceries" on both and confirm
- **THEN** both have the category "Groceries"

#### Scenario: Later transactions don't ask
- **GIVEN** the moved account's transaction on 2026-10-05 with no category
- **WHEN** the user chooses "Groceries" for it
- **THEN** it has the category "Groceries", with no confirmation
