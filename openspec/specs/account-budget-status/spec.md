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

### Requirement: Applying a rule to moved history asks first
When a rule's actions set a category and the user applies the rule from the Rules page to selected transactions, the same confirmation SHALL apply as when choosing the category directly: one confirmation for the batch when any of them is moved history, and Cancel SHALL change none of them.

#### Scenario: Applying a rule to moved history asks once
- **GIVEN** a rule that sets "Groceries", and its matching transactions include the moved account's transaction on 2026-09-15 and its transaction on 2026-10-05
- **WHEN** the user selects both and chooses "Apply actions" and cancels the confirmation
- **THEN** neither changes
- **AND WHEN** they choose "Apply actions" and confirm
- **THEN** both have the category "Groceries"

### Requirement: Move an off-budget account on budget
The app SHALL let the user move an open off-budget account on budget, from the account menu on desktop and on phones. The option SHALL NOT be offered for on-budget or closed accounts. Moving an account on budget SHALL keep its id, transactions, balance, bank-sync link and schedules.

#### Scenario: Menu option on desktop and phones
- **GIVEN** an open off-budget account "Vanguard 401k"
- **WHEN** the user opens its account menu, on desktop or on a phone
- **THEN** it offers "Move on budget…"

#### Scenario: Not offered for on-budget or closed accounts
- **GIVEN** an on-budget account "Checking" and a closed off-budget account "Old Brokerage"
- **WHEN** the user opens either account's menu
- **THEN** neither offers "Move on budget…"

#### Scenario: The account keeps everything
- **GIVEN** an off-budget account "Card" with 40 transactions, a balance of −1,250.00, a bank-sync link and a monthly schedule
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** "Card" is on budget with the same id, the same 40 transactions, a balance of −1,250.00, the same bank-sync link and the same schedule

### Requirement: Warn before moving
Before it moves an account, the app SHALL show the start date and what the move changes, with:
- the number of transactions before the start date, which become uncategorized;
- the number of transactions from the start date on without a category;
- the category counts;
- the transfers;
- the starting balance the budget gains.

The app SHALL move the account only after one confirmation. Cancelling SHALL change nothing.

#### Scenario: Counts match the account
- **GIVEN** an off-budget account with 30 transactions before 2026-10-01 totalling 2,000.00 and 5 from that date on totalling 150.00
- **AND** 2 of those are transfers from "Checking" (on budget) categorized "Savings" on the "Checking" side, and 1 is a transfer to "Mortgage" (off budget)
- **AND** a rule set a category on 4 of this account's own non-transfer transactions before 2026-10-01 and on 1 from that date on
- **AND** this account's side of the transfer from "Checking" on 2026-10-12 has a hidden category
- **WHEN** the user chooses "Move on budget…" with a start date of 2026-10-01
- **THEN** the warning shows 30 transactions before the start date that become uncategorized, "5 categories will be cleared" (the 4 before the start date and the transfer side on 2026-10-12), 4 transactions from the start date with no category, "1 transaction from 2026-10-01 keeps its category" (the transfer side isn't counted there), 3 transfers listed by date, other account and amount, with "Savings" kept on the 2 from "Checking", and a starting balance of 2,000.00

#### Scenario: Cancelling changes nothing
- **GIVEN** the warning is open
- **WHEN** the user cancels
- **THEN** the account is still off budget, and no transaction or budget amount has changed

### Requirement: Category counts in the warning
The warning SHALL show how many categories the move clears, counting this account's transactions before the start date and this account's sides of transfers of any date, and how many non-transfer transactions from the start date on keep their category. This account's sides of transfers SHALL NOT count as kept.

#### Scenario: Transfer sides count as cleared, not kept
- **GIVEN** an off-budget account with 1 non-transfer transaction on 2026-10-05 categorized "Groceries", and this account's side of a transfer from "Checking" on 2026-10-12 with a hidden category "Investments"
- **WHEN** the user chooses "Move on budget…" with a start date of 2026-10-01
- **THEN** the warning says "1 category will be cleared" and "1 transaction from 2026-10-01 keeps its category"

### Requirement: Transfers in the warning
The warning SHALL list the account's transfers: their number, then each one's date, other account and amount, the newest 20 followed by "and N more", with the category that each transfer to an on-budget account keeps.

#### Scenario: Many transfers
- **GIVEN** an off-budget account with 25 transfers
- **WHEN** the user chooses "Move on budget…"
- **THEN** the warning says 25 transfers, lists the 20 newest, and ends with "and 5 more"

### Requirement: Start date
The start date SHALL default to the first day of the current month, and the user SHALL be able to change it before confirming.

#### Scenario: The default start date
- **GIVEN** today is 2026-10-29
- **WHEN** the user chooses "Move on budget…"
- **THEN** the start date is 2026-10-01, and the transactions from 2026-10-01 to today are counted as from the start date

#### Scenario: The counts follow the start date
- **GIVEN** the warning is open with a start date of 2026-10-01
- **WHEN** the user changes the start date to 2026-07-01
- **THEN** the counts and the starting balance are recalculated for 2026-07-01

### Requirement: Starting balance on the start date
Moving an account on budget SHALL add the account's balance as of the start date to the budget, as income in the "Starting Balances" category in the start date's month, and, in envelope budgeting, to "To Budget". It SHALL NOT change the account's balance, and it SHALL NOT change any earlier month's totals. When that balance is zero, the move SHALL add nothing.

#### Scenario: Envelope budget: balance unchanged, To Budget rises, earlier months unchanged
- **GIVEN** an off-budget account whose balance on 2026-10-01 is 2,000.00 and whose history includes a categorized transfer from "Checking"
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **AND** the budget uses envelope budgeting
- **THEN** the account balance is unchanged, October 2026's "To Budget" rises by 2,000.00, and September 2026 and earlier months' totals are unchanged

#### Scenario: Tracking budget: income rises, earlier months unchanged
- **GIVEN** the same account, in a budget that uses tracking budgeting
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** the account balance is unchanged, October 2026's income includes 2,000.00 more in "Starting Balances", and every category's amounts in September 2026 and earlier are unchanged

#### Scenario: Envelope budget: the budget gains the balance from the start date
- **GIVEN** an off-budget account whose transactions before 2026-10-01 total 2,000.00
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** October 2026's "Starting Balances" income includes 2,000.00 more, to budget, and the account balance is unchanged

#### Scenario: Earlier months change only by uncategorized amounts
- **GIVEN** the move above
- **WHEN** the user views September 2026 and earlier
- **THEN** every category's budgeted, spent and balance amounts are unchanged, and the only difference is the uncategorized transactions the warning listed

#### Scenario: A negative balance
- **GIVEN** an off-budget credit card whose transactions before 2026-10-01 total −1,250.00
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** October 2026's "Starting Balances" income is 1,250.00 lower, and the card's balance is unchanged

#### Scenario: Nothing before the start date
- **GIVEN** an off-budget account with no transactions before the start date
- **WHEN** the user moves it on budget
- **THEN** no starting balance transaction is added

### Requirement: One adjustment transaction
The starting balance SHALL be one split transaction on the start date that nets to zero on the account: a "Starting Balance" line in the "Starting Balances" category, and an offset line with no category and the note "Offsets transactions before <start date> (moved on budget)".

#### Scenario: The adjustment in the register
- **GIVEN** an off-budget account whose transactions before 2026-10-01 total 2,000.00
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** the register shows one split transaction on 2026-10-01 with payee "Starting Balance" and a total of 0.00, with a 2,000.00 line in "Starting Balances" and a −2,000.00 uncategorized line noted "Offsets transactions before 2026-10-01 (moved on budget)"

### Requirement: Categories before and from the start date
Moving an account on budget SHALL clear the category of each of this account's transactions dated before the start date, and of this account's side of every transfer whatever its date. It SHALL keep the categories of its other transactions from the start date on. It SHALL NOT change any category on another account's transactions, including the other side of a transfer.

#### Scenario: Hidden category before the start date
- **GIVEN** an off-budget transaction of −80.00 on 2026-09-15 with category "Groceries", set by a rule
- **WHEN** the user moves the account on budget with a start date of 2026-10-01
- **THEN** that transaction is uncategorized, September 2026's "Groceries" is unchanged, and the account balance is unchanged

#### Scenario: Hidden category after the start date
- **GIVEN** an off-budget transaction of −60.00 on 2026-10-10 with category "Groceries"
- **WHEN** the user moves the account on budget with a start date of 2026-10-01
- **THEN** that transaction keeps "Groceries", and October 2026's "Groceries" spending includes the 60.00

#### Scenario: Hidden category on this side of a later transfer
- **GIVEN** a transfer of 500.00 on 2026-10-12 from "Checking" (on budget, categorized "Savings" on its side) to the off-budget account, whose side has a hidden category "Investments"
- **WHEN** the user moves the account on budget with a start date of 2026-10-01
- **THEN** this account's side is uncategorized, the "Checking" side keeps "Savings", October 2026's "Investments" is unchanged, and the 500.00 counts once in the budget

#### Scenario: A categorized transfer
- **GIVEN** a transfer of 500.00 from "Checking" (on budget) to the off-budget account, categorized "Savings" on the "Checking" side
- **WHEN** the user moves the account on budget
- **THEN** the "Checking" side keeps the category "Savings", and September's "Savings" spending is unchanged

### Requirement: Undo and sync
Moving an account on budget SHALL be one undoable step, and other devices SHALL show the same result after they sync.

#### Scenario: Undo
- **GIVEN** the user has just moved an account on budget
- **WHEN** the user undoes
- **THEN** the account is off budget again, the starting balance transaction is gone, and the budget is as it was

#### Scenario: Undo restores cleared categories
- **GIVEN** the move cleared "Groceries" from the transaction on 2026-09-15
- **WHEN** the user undoes
- **THEN** that transaction has the category "Groceries" again

#### Scenario: Another device
- **GIVEN** two devices share a synced budget
- **WHEN** one device moves an account on budget and both sync
- **THEN** the other device shows the account on budget, with the same starting balance and the same budget amounts
