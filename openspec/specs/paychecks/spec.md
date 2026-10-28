# paychecks Specification

## Purpose
Lets the user define an employer paycheck once (pay dates, gross pay, deductions and direct deposits) and keeps an on-budget clearing account and its schedules in step, so the budget sees gross pay and deductions on the pay date and each deposit on its bank's date.

## Requirements

### Requirement: Paycheck definition
With the `businessCalendars` experimental feature on, the desktop schedules page SHALL offer "Add paycheck". A paycheck SHALL have a name, an employer payee, a clearing account, pay dates (a repeating pattern moved before or after the clearing account calendar's non-business days), gross pay with an income category, zero or more deductions (each a name, amount, and a category or a transfer to another account) and one or more direct deposits to other accounts.

#### Scenario: Hidden when the feature is off
- **WHEN** the `businessCalendars` experimental feature is off
- **THEN** the schedules page does not offer "Add paycheck"

### Requirement: Net pay and deposit amounts
Net pay SHALL be gross pay minus deductions. Each deposit SHALL be fixed, a percent of net pay, or the remainder, and the editor SHALL show net pay and each deposit's resulting amount as the user edits.

#### Scenario: Define a paycheck
- **GIVEN** the clearing account "Acme Paycheck" uses "U.S. Federal Holidays"
- **WHEN** the user saves "Acme" paid on the 15th and last day of each month, moved before non-business days, with gross pay 3,000.00 to "Income", deductions "Federal tax" 450.00 to "Taxes", "Health" 120.00 to "Insurance" and "401(k)" 180.00 as a transfer to "Retirement", and deposits 10% to "Savings" and the remainder to "Checking"
- **THEN** the editor shows net pay 2,250.00, "Savings" 225.00 and "Checking" 2,025.00

### Requirement: Clearing account
A paycheck's clearing account SHALL be an on-budget account: either a new one the editor creates, named after the employer by default, or an existing on-budget account.

#### Scenario: Create the clearing account
- **WHEN** the user chooses a new clearing account for employer "Acme" and saves
- **THEN** an on-budget account "Acme Paycheck" exists with a starting balance of zero

### Requirement: Rounding
Percent deposits SHALL be rounded to the cent, and the single remainder deposit SHALL receive net pay minus all other deposits, so rounding never leaves money in the clearing account.

#### Scenario: Rounding goes to the remainder
- **WHEN** net pay is 1,000.01 with deposits 33% to "Savings" and the remainder to "Checking"
- **THEN** "Savings" is 330.00 and "Checking" is 670.01

Percent deposits totalling 100% with no remainder SHALL add up to net pay to the cent: the last percent deposit SHALL receive net pay minus all other deposits.

#### Scenario: Odd-cent 50/50 split
- **WHEN** net pay is 100.01 with deposits 50% to "Savings" and 50% to "Checking" and no remainder
- **THEN** "Savings" is 50.01, "Checking" is 50.00, and the paycheck saves

### Requirement: Paycheck validation
A paycheck SHALL NOT be saved when deductions exceed gross pay, fixed and percent deposits exceed net pay, percents total more than 100, more than one deposit is the remainder, or deposits without a remainder do not add up to net pay. The editor SHALL say which rule failed. An invalid paycheck SHALL be rejected before anything is written, including when two deposit accounts share a name (their deposit schedules would share a name).

#### Scenario: Deposit accounts that share a name
- **GIVEN** two different accounts are both named "Savings"
- **WHEN** the user saves a new or existing paycheck with a deposit to each
- **THEN** the paycheck is not saved, the editor says the deposit accounts need different names, and no schedules, rules or accounts are added or changed

A deduction's transfer account SHALL exist; otherwise the paycheck is rejected before anything is written.

#### Scenario: Deleted transfer account
- **GIVEN** the "401(k)" deduction transfers to "Retirement", and "Retirement" was deleted on another device while the editor was open
- **WHEN** the user saves a new paycheck with a new clearing account, or saves an existing paycheck
- **THEN** the paycheck is not saved, the editor says the transfer account for "401(k)" no longer exists, and no accounts, payees, schedules or rules are added or changed

#### Scenario: Deposits that do not add up
- **WHEN** net pay is 2,250.00 and the only deposit is a fixed 2,000.00 to "Checking"
- **THEN** the paycheck is not saved and the editor says the deposits must add up to net pay or include a remainder

#### Scenario: Deductions larger than gross pay
- **WHEN** deductions total more than gross pay
- **THEN** the paycheck is not saved and the editor says deductions exceed gross pay

### Requirement: Pay schedule
Saving a paycheck SHALL create or update, in one undoable step, a pay schedule on the clearing account for net pay on the pay dates. It SHALL post automatically one split transaction: gross pay to its income category and each deduction as a negative split to its category or transfer.

#### Scenario: Pay date posts gross pay and deductions
- **WHEN** the pay schedule posts on November 13, 2026
- **THEN** "Acme Paycheck" has one transaction of 2,250.00 split into 3,000.00 "Income", -450.00 "Taxes", -120.00 "Insurance" and a -180.00 transfer to "Retirement", and the budget shows 3,000.00 income in November

### Requirement: Deposit schedules
The same step SHALL keep one deposit schedule per direct deposit on its receiving account, for that deposit's amount, dated by the account's early-deposit rule relative to the pay schedule. Its transactions SHALL be transfers from the clearing account. Deposit schedules SHALL match imports by approximate amount and date. Paycheck schedules SHALL appear in the schedules list named after the paycheck and behave like any schedule.

#### Scenario: Pay date and deposit dates
- **GIVEN** the "Acme" paycheck, "Checking" deposits arrive 2 business days early in "U.S. Federal Reserve", and "Savings" deposits arrive 0 days early in "U.S. Federal Reserve"
- **WHEN** the user views upcoming dates in November 2026
- **THEN** the pay schedule shows Friday, November 13 and Monday, November 30, "Checking" shows Tuesday, November 10 and Wednesday, November 25, and "Savings" shows Friday, November 13 and Monday, November 30

#### Scenario: Bank-synced deposit links to its schedule
- **WHEN** bank sync imports a 2,031.40 deposit to "Checking" on November 10, 2026
- **THEN** it links to the "Checking" deposit schedule and becomes a transfer from "Acme Paycheck" instead of a separate income transaction

#### Scenario: Deposit far from the expected amount
- **WHEN** bank sync imports a 2,600.00 deposit to "Checking" on November 10, 2026
- **THEN** it does not link to the deposit schedule

### Requirement: Posting deposits automatically
Each direct deposit SHALL have a "Post automatically" option, off by default. When on, its deposit schedule posts the transfer from the clearing account on the deposit date. The editor SHALL note that a posted deposit merges with a bank-synced import only when the amounts are exactly equal, so deposits that vary should stay off.

#### Scenario: Off by default
- **WHEN** the user adds a deposit to "Checking"
- **THEN** "Post automatically" is off and no transaction is added to "Checking" until a deposit is imported or entered

#### Scenario: Manual account
- **GIVEN** "Savings" is not bank-synced and its 225.00 (10%) deposit posts automatically
- **WHEN** November 13, 2026 arrives
- **THEN** "Savings" has a 225.00 transfer from "Acme Paycheck" dated November 13, 2026

#### Scenario: Exact import merges with the posted deposit
- **GIVEN** the "Savings" deposit posted 225.00 on November 13, 2026
- **WHEN** bank sync imports a 225.00 deposit to "Savings" on November 13, 2026
- **THEN** the import merges into the posted transfer and "Savings" has one deposit

#### Scenario: The editor explains the trade-off
- **WHEN** the user turns on "Post automatically" for a deposit
- **THEN** the editor notes that a bank-synced deposit merges only when its amount is exactly the same

### Requirement: Editing and deleting paychecks
Opening a paycheck's schedule SHALL offer to edit the paycheck. Saving changes SHALL update its schedules in one undoable step and SHALL NOT change transactions already posted or linked. Deleting a paycheck SHALL delete its schedules and keep its clearing account and existing transactions. Undo SHALL restore the previous paycheck and schedules.

#### Scenario: Raise
- **WHEN** the user changes "Acme" gross pay to 3,200.00
- **THEN** future pay and deposit schedules use the new amounts and November's posted transactions are unchanged

#### Scenario: Remove a deposit
- **WHEN** the user removes the "Savings" deposit and saves
- **THEN** the "Savings" deposit schedule is deleted and "Checking" becomes the whole net pay

#### Scenario: Delete a paycheck
- **WHEN** the user deletes "Acme"
- **THEN** its schedules are gone, "Acme Paycheck" and its transactions remain, and undo restores the paycheck and its schedules

### Requirement: Skip next paycheck
A paycheck SHALL offer "Skip next paycheck", which skips the next occurrence of its pay schedule and of each deposit schedule together in one undoable step.

#### Scenario: Unpaid leave
- **WHEN** the user skips the next "Acme" paycheck on November 1, 2026
- **THEN** the pay schedule's next date is November 30 and the deposit schedules' next dates are November 25 ("Checking") and November 30 ("Savings")
