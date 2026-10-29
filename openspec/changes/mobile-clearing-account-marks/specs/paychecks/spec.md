# Spec Delta

## MODIFIED Requirements

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
A deposit of a paycheck's most recent posted pay date is missing when it has no linked transaction. Once every missing deposit (or, when none is missing, every deposit) is past its expected date by more than 2 business days (of that deposit account's calendar) and the clearing account's balance is not zero, the clearing account note SHALL be followed by a warning stating the balance and naming each missing deposit. On desktop layouts the warning follows the note in the same line. On narrow (mobile) layouts it is on its own line below the note. The text and timing are the same on both.

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
