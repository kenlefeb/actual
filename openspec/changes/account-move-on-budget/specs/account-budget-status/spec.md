# Spec Delta

## ADDED Requirements

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
- the number of transactions that become uncategorized, before the start date and from it on;
- the number of transfers, then each one's date, other account and amount, the first 20 followed by "and N more", with the category each transfer to an on-budget account keeps;
- the starting balance the budget gains.

The app SHALL move the account only after one confirmation. Cancelling SHALL change nothing.

#### Scenario: Counts match the account
- **GIVEN** an off-budget account with 30 transactions before 2026-10-01 totalling 2,000.00 and 5 from that date on totalling 150.00
- **AND** 2 of those are transfers from "Checking" (on budget) categorized "Savings", and 1 is a transfer to "Mortgage" (off budget)
- **WHEN** the user chooses "Move on budget…" with a start date of 2026-10-01
- **THEN** the warning shows 30 transactions that become uncategorized before the start date and 5 from it, 3 transfers listed by date, other account and amount, with "Savings" kept on the 2 from "Checking", and a starting balance of 2,000.00

#### Scenario: Many transfers
- **GIVEN** an off-budget account with 25 transfers
- **WHEN** the user chooses "Move on budget…"
- **THEN** the warning says 25 transfers, lists the 20 newest, and ends with "and 5 more"

#### Scenario: Cancelling changes nothing
- **GIVEN** the warning is open
- **WHEN** the user cancels
- **THEN** the account is still off budget, and no transaction or budget amount has changed

### Requirement: Start date
The start date SHALL default to the first day of the current month, and the user SHALL be able to change it before confirming.

#### Scenario: The default start date
- **GIVEN** today is 2026-10-29
- **WHEN** the user chooses "Move on budget…"
- **THEN** the start date is 2026-10-01, and the transactions from 2026-10-01 to today are counted as becoming uncategorized from the start date

#### Scenario: The counts follow the start date
- **GIVEN** the warning is open with a start date of 2026-10-01
- **WHEN** the user changes the start date to 2026-07-01
- **THEN** the counts and the starting balance are recalculated for 2026-07-01

### Requirement: Starting balance on the start date
Moving an account on budget SHALL add the account's balance as of the start date to the budget, as income in the "Starting Balances" category in the start date's month. It SHALL NOT change the account's balance, and it SHALL NOT change any earlier month's totals. When that balance is zero, the move SHALL add nothing.

#### Scenario: Balance unchanged, To Budget rises, earlier months unchanged
- **GIVEN** an off-budget account whose balance on 2026-10-01 is 2,000.00 and whose history includes a categorized transfer from "Checking"
- **WHEN** the user moves it on budget with a start date of 2026-10-01
- **THEN** the account balance is unchanged, October 2026's "To Budget" rises by 2,000.00, and September 2026 and earlier months' totals are unchanged

#### Scenario: The budget gains the balance from the start date
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

### Requirement: Transfers keep their categories
Moving an account on budget SHALL NOT change the category of any existing transaction, including transfers to on-budget accounts.

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

#### Scenario: Another device
- **GIVEN** two devices share a synced budget
- **WHEN** one device moves an account on budget and both sync
- **THEN** the other device shows the account on budget, with the same starting balance and the same budget amounts
