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
- the number and total of transactions that become uncategorized, before the start date and from it on;
- the transfers to on-budget accounts, each with the category it keeps;
- the number of transfers to off-budget accounts, which become uncategorized;
- the starting balance the budget gains.

The app SHALL move the account only after the user confirms. Cancelling SHALL change nothing.

#### Scenario: Counts match the account
- **GIVEN** an off-budget account with 30 transactions before 2026-10-01 totalling 2,000.00 and 5 from that date on totalling 150.00
- **AND** 2 of those are transfers from "Checking" (on budget) categorized "Savings", and 1 is a transfer to "Mortgage" (off budget)
- **WHEN** the user chooses "Move on budget…" with a start date of 2026-10-01
- **THEN** the warning shows the transactions that become uncategorized, before and from the start date, the 2 transfers with their category "Savings", 1 transfer to an off-budget account, and a starting balance of 2,000.00

#### Scenario: Cancelling changes nothing
- **GIVEN** the warning is open
- **WHEN** the user cancels
- **THEN** the account is still off budget, and no transaction or budget amount has changed

#### Scenario: The counts follow the start date
- **GIVEN** the warning is open with a start date of 2026-10-01
- **WHEN** the user changes the start date to 2026-07-01
- **THEN** the counts and the starting balance are recalculated for 2026-07-01

### Requirement: Starting balance on the start date
Moving an account on budget SHALL add the account's balance as of the start date to the budget, as income in the "Starting Balances" category in the start date's month. It SHALL NOT change the account's balance. When that balance is zero, the move SHALL add nothing.

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
