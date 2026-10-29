# Spec Delta

## ADDED Requirements

### Requirement: Edits on two devices
A paycheck's generated schedules SHALL be exactly the ones its definition lists. After every successful sync, before it posts any scheduled transaction, the app SHALL delete each generated schedule that no live definition lists, and SHALL restore each schedule a live definition lists that is missing or deleted. The same check SHALL run when the budget opens and when the paycheck is saved.

#### Scenario: Both devices add a deposit
- **GIVEN** the "Acme" paycheck deposits to "Savings" and "Checking"
- **AND** on one device the user adds a "Travel" deposit, while another device, offline, adds an "Emergency" deposit
- **WHEN** both devices sync, and the merged "Acme" lists "Savings", "Checking" and "Travel"
- **THEN** the "Acme → Emergency" deposit schedule is deleted on both devices, and the remaining deposit schedules add up to Acme's net pay

#### Scenario: Forecasts count each deposit once
- **GIVEN** the merge above
- **WHEN** the user views the balance forecast for "Emergency"
- **THEN** it shows no Acme deposits, and the forecast for the other accounts shows each Acme deposit once

#### Scenario: Nothing posts before the clean-up
- **GIVEN** the "Emergency" deposit posts automatically, and its next date is today
- **WHEN** a sync brings in the edit that leaves it unlisted
- **THEN** the schedule is deleted before the app posts the day's scheduled transactions, and no new "Emergency" transfer is posted

#### Scenario: A later sync on the same day
- **GIVEN** the app already synced today and posted the day's scheduled transactions
- **WHEN** a later sync that day brings in the edit that leaves "Acme → Emergency" unlisted
- **THEN** "Acme → Emergency" is deleted after that sync, not the next day

#### Scenario: Saved again while the other device cleaned up
- **GIVEN** one device deleted "Acme → Emergency" after a merge left it unlisted
- **AND** before receiving that deletion, the other device saved "Acme" again, and its newer definition lists "Acme → Emergency"
- **WHEN** both devices sync
- **THEN** "Acme → Emergency" is active again, and Acme's deposit schedules add up to its net pay

#### Scenario: Deleted on one device, edited on the other
- **GIVEN** one device deletes "Acme" while another device, offline, adds an "Emergency" deposit to it
- **WHEN** both devices sync and "Acme" stays deleted
- **THEN** no "Acme" schedule remains active, including "Acme → Emergency", and "Acme Paycheck" and its transactions remain

### Requirement: Clean-up after edits on two devices
Deleting a schedule left behind by edits on two devices SHALL keep the transactions already posted or linked from it. A schedule the user created SHALL never be deleted this way, even when it is relative to a paycheck's pay schedule.

#### Scenario: A deposit that already posted
- **GIVEN** the "Emergency" deposit posts automatically and posted a 200.00 transfer on November 13, 2026, before the other device's edit synced
- **WHEN** the merge leaves "Acme → Emergency" unlisted and it is deleted
- **THEN** the 200.00 transfer stays in "Emergency"

#### Scenario: A user's own schedule relative to the pay date
- **GIVEN** the user created a "Gym" schedule dated 1 business day after the "Acme" pay schedule
- **WHEN** a sync brings in any edit of "Acme"
- **THEN** "Gym" is kept
