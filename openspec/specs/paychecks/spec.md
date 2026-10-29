# paychecks Specification

## Purpose
Lets the user define an employer paycheck once (pay dates, gross pay, deductions and direct deposits) and keeps an on-budget clearing account and its schedules in step, so the budget sees gross pay and deductions on the pay date and each deposit on its bank's date.

## Requirements

### Requirement: Paycheck definition
With the `paychecks` experimental feature on, the schedules page SHALL offer "Add paycheck" on desktop and mobile layouts. A paycheck SHALL have a name, an employer payee, a clearing account, pay dates (a repeating pattern moved before or after the clearing account calendar's non-business days), gross pay with an income category, zero or more deductions (each a name, amount, and a category or a transfer to another account) and one or more direct deposits to other accounts.

#### Scenario: Hidden when the feature is off
- **WHEN** the `paychecks` experimental feature is off
- **THEN** the schedules page does not offer "Add paycheck"

### Requirement: Paychecks feature
Turning on `paychecks` SHALL also turn on `businessCalendars`. `paychecks` SHALL count as on only while `businessCalendars` is on, and an unset `paychecks` flag SHALL start on exactly when `businessCalendars` is on. Turning either feature off SHALL hide paycheck entry points but keep paychecks and their schedules. The lock while a paycheck exists is in `business-calendars` "Experimental feature flag".

#### Scenario: Turning on paychecks turns on business calendars
- **WHEN** the user turns on `paychecks` while `businessCalendars` is off
- **THEN** both features are on

#### Scenario: Existing paychecks stay visible on upgrade
- **GIVEN** a budget with the "Acme" paycheck and `businessCalendars` on, from a release before the `paychecks` feature existed
- **WHEN** the user opens it in this release
- **THEN** `paychecks` is on and "Acme" appears in the Paychecks section

#### Scenario: Acme stays hidden while business calendars are off
- **GIVEN** a budget with the "Acme" paycheck whose stored settings have `paychecks` on and `businessCalendars` off (for example, set by an earlier release)
- **WHEN** the user opens the Schedules page
- **THEN** `paychecks` counts as off: the page offers no "Add paycheck" and no Paychecks section, so the paycheck editor's calendar and days-early fields can't be reached, and Acme's schedules keep their dates

#### Scenario: Upgrade with business calendars off
- **GIVEN** a budget with the "Acme" paycheck, `businessCalendars` off and `paychecks` never set
- **WHEN** the user opens it in this release
- **THEN** `paychecks` is off, and turning on Paychecks turns both features on and shows "Acme" in the Paychecks section

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

### Requirement: Clearing account note
A clearing account SHALL show a paycheck icon beside its name in the sidebar on desktop layouts and in the accounts list on narrow (mobile) layouts. Its register on desktop, and its account page above the transaction list on narrow layouts, SHALL show a note naming its paycheck and saying it should return to zero after each payday. The icon and note SHALL appear only while the `paychecks` experimental feature is on, and only for an account that is a paycheck's clearing account.

#### Scenario: Marked as a clearing account
- **WHEN** the user views the sidebar and opens "Acme Paycheck"
- **THEN** "Acme Paycheck" has a paycheck icon, and its register notes that it is the clearing account for "Acme" and should return to zero after each payday

#### Scenario: Acme Paycheck is marked on a phone
- **GIVEN** the `paychecks` experimental feature is on and the layout is narrow
- **WHEN** the user opens Accounts and taps "Acme Paycheck"
- **THEN** the "Acme Paycheck" row in the accounts list has a paycheck icon labelled as the clearing account for paycheck "Acme", and the account page notes above its transactions that it is the clearing account for "Acme" and should return to zero after each payday, in the same words as the desktop register

#### Scenario: Checking is not marked on a phone
- **GIVEN** the layout is narrow and "Checking" receives an "Acme" deposit but is not a clearing account
- **WHEN** the user opens Accounts and taps "Checking"
- **THEN** neither the "Checking" row nor its account page shows the paycheck icon, note or warning

#### Scenario: Not marked with paychecks turned off
- **GIVEN** the `paychecks` experimental feature is off
- **WHEN** the user opens "Acme Paycheck", on desktop or on a phone
- **THEN** no paycheck icon, note or warning is shown for it

### Requirement: Clearing account warning
A deposit of a paycheck's most recent posted pay date is missing when it has no linked transaction. Once every missing deposit (or, when none is missing, every deposit) is past its expected date by more than 2 business days (of that deposit account's calendar) and the clearing account's balance is not zero, the clearing account note SHALL be followed by a warning stating the balance and naming each missing deposit.

#### Scenario: Missing deposit
- **GIVEN** the November 13, 2026 "Acme" pay posted, the "Savings" deposit arrived and the "Checking" deposit (expected Tuesday, November 10) did not
- **WHEN** the user opens "Acme Paycheck" on Monday, November 16
- **THEN** the register shows the note followed, in the same line, by a warning that 2,025.00 remains and the "Checking" deposit has not arrived

#### Scenario: No warning while imports may still arrive
- **GIVEN** the November 30, 2026 "Acme" pay posted and the "Checking" deposit is expected Wednesday, November 25
- **WHEN** the user opens "Acme Paycheck" on Thursday, November 26
- **THEN** the register shows the note, not a warning

#### Scenario: Acme Paycheck still holds 2,250.00 after payday on a phone
- **GIVEN** the layout is narrow, the November 13, 2026 "Acme" pay posted, and neither the "Checking" deposit (expected Tuesday, November 10) nor the "Savings" deposit (expected Friday, November 13) arrived
- **WHEN** the user opens "Acme Paycheck" on a phone on Wednesday, November 18
- **THEN** below the note, on its own line, the account page warns that 2,250.00 is still in "Acme Paycheck", waiting on the deposits to Checking and Savings, in the same words as the desktop register

#### Scenario: No warning on a phone while imports may still arrive
- **GIVEN** the layout is narrow, the November 30, 2026 "Acme" pay posted and the "Checking" deposit is expected Wednesday, November 25
- **WHEN** the user opens "Acme Paycheck" on a phone on Thursday, November 26
- **THEN** the account page shows the note, not a warning

### Requirement: Clearing account warning placement
On desktop layouts the clearing account warning SHALL follow the note in the same line. On narrow (mobile) layouts it SHALL be on its own line below the note. Its text and timing are the same on both.

#### Scenario: Warning in the note's line on desktop
- **WHEN** the clearing account warning shows in the register on a desktop layout
- **THEN** it follows the note in the same line

#### Scenario: Warning on its own line on a phone
- **WHEN** the clearing account warning shows on the account page on a narrow layout
- **THEN** it is on its own line below the note, in the same words as on desktop

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
Opening a paycheck's schedule SHALL offer to edit the paycheck. Saving changes SHALL update its schedules in one undoable step and SHALL NOT change transactions already posted or linked. Deleting a paycheck SHALL delete its schedules and keep its clearing account and existing transactions. Undo SHALL restore the previous paycheck and schedules. The API SHALL refuse to update or delete a paycheck's pay or deposit schedule, or to update its rule, with an error naming the paycheck and no change.

#### Scenario: Raise
- **WHEN** the user changes "Acme" gross pay to 3,200.00
- **THEN** future pay and deposit schedules use the new amounts and November's posted transactions are unchanged

#### Scenario: Change how often pay arrives
- **WHEN** the user opens "Acme" pay dates, changes "Repeat every 1 month" to "Repeat every 1 week" and applies
- **THEN** the editor shows a weekly pay pattern, and saving moves the pay and deposit schedules to weekly dates

#### Scenario: Remove a deposit
- **WHEN** the user removes the "Savings" deposit and saves
- **THEN** the "Savings" deposit schedule is deleted and "Checking" becomes the whole net pay

#### Scenario: Delete a paycheck
- **WHEN** the user deletes "Acme"
- **THEN** its schedules are gone, "Acme Paycheck" and its transactions remain, and undo restores the paycheck and its schedules

#### Scenario: A script edits Acme's Checking deposit schedule
- **WHEN** an API script calls `updateSchedule` on the "Acme → Checking" deposit schedule to change its amount
- **THEN** the call fails with "This schedule is managed by paycheck "Acme". Edit the paycheck in the app." and the schedule's amount, date and name are unchanged

#### Scenario: A script deletes Acme's pay schedule
- **WHEN** an API script calls `deleteSchedule` on the "Acme" pay schedule
- **THEN** the call fails with the same error, and the pay schedule and its rule still exist

#### Scenario: A script edits the rule behind Acme's pay schedule
- **WHEN** an API script calls `updateRule` on the rule of the "Acme" pay schedule
- **THEN** the call fails with the same error, and the rule is unchanged

#### Scenario: A script deletes the rule behind Acme's pay schedule
- **WHEN** an API script calls `deleteRule` on the rule of the "Acme" pay schedule
- **THEN** the call resolves to `false` without deleting anything, as it already does for the rule of any schedule, and the rule and the pay schedule still exist

#### Scenario: A script edits and deletes the Rent schedule
- **GIVEN** a "Rent" schedule that no paycheck lists
- **WHEN** an API script updates its amount and then deletes it
- **THEN** both calls succeed

#### Scenario: The app still manages Acme's schedules
- **GIVEN** the API refused an edit of "Acme"'s schedules
- **WHEN** the user raises "Acme" in the app, skips its next paycheck, and then deletes it
- **THEN** each action updates, advances and finally deletes the pay and deposit schedules as before

### Requirement: Skip next paycheck
A paycheck SHALL offer "Skip next paycheck", which skips the next occurrence of its pay schedule and of each deposit schedule together in one undoable step.

#### Scenario: Unpaid leave
- **WHEN** the user skips the next "Acme" paycheck on November 1, 2026
- **THEN** the pay schedule's next date is November 30 and the deposit schedules' next dates are November 25 ("Checking") and November 30 ("Savings")

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
