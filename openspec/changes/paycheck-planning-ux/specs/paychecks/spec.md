# Spec Delta

## MODIFIED Requirements

### Requirement: Paycheck definition
With the `paychecks` experimental feature on, the schedules page SHALL offer "Add paycheck" on desktop and mobile layouts. Turning on `paychecks` SHALL also turn on `businessCalendars`. The `paychecks` feature SHALL start on for a budget that already has a paycheck or has `businessCalendars` on. A paycheck SHALL have a name, an employer payee, a clearing account, pay dates (a repeating pattern moved before or after the clearing account calendar's non-business days), gross pay with an income category, zero or more deductions (each a name, amount, and a category or a transfer to another account) and one or more direct deposits to other accounts.

#### Scenario: Hidden when the feature is off
- **WHEN** the `paychecks` experimental feature is off
- **THEN** the schedules page does not offer "Add paycheck"

#### Scenario: Turning on paychecks turns on business calendars
- **WHEN** the user turns on `paychecks` while `businessCalendars` is off
- **THEN** both features are on

#### Scenario: Existing paychecks stay visible on upgrade
- **GIVEN** a budget with the "Acme" paycheck and `businessCalendars` on, from a release before the `paychecks` feature existed
- **WHEN** the user opens it in this release
- **THEN** `paychecks` is on and "Acme" appears in the Paychecks section

### Requirement: Clearing account
A paycheck's clearing account SHALL be an on-budget account: either a new one the editor creates, named after the employer by default, or an existing on-budget account. A clearing account SHALL show a paycheck icon beside its name in the sidebar, and its register SHALL show a note naming its paycheck and saying it should return to zero after each payday. Once every deposit of a paycheck's most recent posted pay date is past its expected date by more than 2 business days (of that deposit account's calendar) and the clearing account's balance is not zero, the note SHALL become a warning stating the balance and naming each deposit not yet linked or entered.

#### Scenario: Create the clearing account
- **WHEN** the user chooses a new clearing account for employer "Acme" and saves
- **THEN** an on-budget account "Acme Paycheck" exists with a starting balance of zero

#### Scenario: Marked as a clearing account
- **WHEN** the user views the sidebar and opens "Acme Paycheck"
- **THEN** "Acme Paycheck" has a paycheck icon, and its register notes that it is the clearing account for "Acme" and should return to zero after each payday

#### Scenario: Missing deposit
- **GIVEN** the November 13, 2026 "Acme" pay posted, the "Savings" deposit arrived and the "Checking" deposit (expected Tuesday, November 10) did not
- **WHEN** the user opens "Acme Paycheck" on Monday, November 16
- **THEN** the register warns that 2,025.00 remains and the "Checking" deposit has not arrived

#### Scenario: No warning while imports may still arrive
- **GIVEN** the November 30, 2026 "Acme" pay posted and the "Checking" deposit is expected Wednesday, November 25
- **WHEN** the user opens "Acme Paycheck" on Thursday, November 26
- **THEN** the register shows the note, not a warning

### Requirement: Deposit schedules
The same step SHALL keep one deposit schedule per direct deposit on its receiving account, for that deposit's amount, dated by the account's early-deposit rule relative to the pay schedule. Its transactions SHALL be transfers from the clearing account. Deposit schedules SHALL match imports by approximate amount and date. A paycheck's pay and deposit schedules SHALL NOT appear in the schedules list; they SHALL be reached from the paycheck's row and editor, and otherwise behave like any schedule.

#### Scenario: Pay date and deposit dates
- **GIVEN** the "Acme" paycheck, "Checking" deposits arrive 2 business days early in "U.S. Federal Reserve", and "Savings" deposits arrive 0 days early in "U.S. Federal Reserve"
- **WHEN** the user views upcoming dates in November 2026
- **THEN** the pay schedule shows Friday, November 13 and Monday, November 30, "Checking" shows Tuesday, November 10 and Wednesday, November 25, and "Savings" shows Friday, November 13 and Monday, November 30

#### Scenario: Paycheck schedules are listed once
- **WHEN** the user opens the Schedules page with the "Acme" paycheck
- **THEN** "Acme", "Acme → Checking" and "Acme → Savings" are not in the schedules list, and "Acme" appears once in the Paychecks section

#### Scenario: Bank-synced deposit links to its schedule
- **WHEN** bank sync imports a 2,031.40 deposit to "Checking" on November 10, 2026
- **THEN** it links to the "Checking" deposit schedule and becomes a transfer from "Acme Paycheck" instead of a separate income transaction

#### Scenario: Deposit far from the expected amount
- **WHEN** bank sync imports a 2,600.00 deposit to "Checking" on November 10, 2026
- **THEN** it does not link to the deposit schedule

## ADDED Requirements

### Requirement: Business days early from the editor
For each direct deposit the editor SHALL show the receiving account's business calendar and business days early, and SHALL let the user change the days early in place. Saving that change SHALL update the account (as the account's "Business days" does) and SHALL say it applies to every paycheck depositing into that account.

#### Scenario: Change days early in the editor
- **GIVEN** "Checking" deposits arrive 2 business days early and the "Acme" and "Side gig" paychecks both deposit to "Checking"
- **WHEN** the user changes the "Checking" deposit to 1 business day early in the "Acme" editor and saves
- **THEN** "Checking" is 1 business day early, both paychecks' "Checking" deposit dates move, and the editor said the change applies to every paycheck depositing to "Checking"

### Requirement: Year-to-date summary
The editor SHALL show, for the current and previous calendar year, the totals of the paycheck's posted pay transactions: gross pay, each deduction by name, and net pay. Totals SHALL come from the transactions as posted, including any edits made to them.

#### Scenario: Check against a W-2
- **GIVEN** 2025 had 24 "Acme" paychecks posted, one of them edited to add a 500.00 bonus to gross pay
- **WHEN** the user opens the "Acme" editor in 2026
- **THEN** the 2025 summary shows gross pay 72,500.00, each deduction's total, and the resulting net pay

### Requirement: Mobile paycheck editor
On mobile layouts the user SHALL be able to create, edit, delete and skip paychecks. The mobile editor SHALL be one scrolling page with the same sections as the desktop editor; each section SHALL collapse to a one-line summary, and net pay SHALL stay visible at the bottom while editing.

#### Scenario: Set up a paycheck on a phone
- **WHEN** a user on a phone creates the "Acme" paycheck from the Schedules page
- **THEN** the paycheck is saved with the same schedules a desktop save creates

#### Scenario: Net pay stays visible
- **WHEN** the user edits deductions with the deposits section collapsed on a phone
- **THEN** net pay at the bottom of the screen updates with each change
