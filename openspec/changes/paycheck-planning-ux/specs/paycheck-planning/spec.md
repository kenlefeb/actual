# Spec Delta

## Purpose
Shows each paycheck as one plannable item — when the next one arrives and what lands in which account — at the top of the Schedules page on desktop and mobile, so planning doesn't require reading generated schedules.

## ADDED Requirements

### Requirement: Paychecks section
With the `paychecks` experimental feature on, the Schedules page SHALL show a Paychecks section above the schedules list on desktop and mobile layouts, with one row per paycheck ordered by next pay date. Each row SHALL show the paycheck's name, its next pay date and net pay, and for each direct deposit the receiving account, amount and expected date. Selecting a row SHALL open that paycheck's editor.

#### Scenario: Next paycheck at a glance
- **GIVEN** the "Acme" paycheck (net pay 2,250.00; "Checking" 2,025.00 two business days early; "Savings" 225.00 on the pay date) and today is November 2, 2026
- **WHEN** the user opens the Schedules page
- **THEN** the "Acme" row shows Friday, November 13, 2026 and 2,250.00, "Checking · 2,025.00 · Tuesday, November 10" and "Savings · 225.00 · Friday, November 13"

#### Scenario: Open the editor from a row
- **WHEN** the user selects the "Acme" row
- **THEN** the "Acme" paycheck editor opens

#### Scenario: Hidden when the feature is off
- **WHEN** the `paychecks` experimental feature is off
- **THEN** the Schedules page shows no Paychecks section

### Requirement: Upcoming paychecks
Each row SHALL offer "Show more", which reveals the next three paychecks after the next one, each with its date, net pay and deposits.

#### Scenario: Show more
- **WHEN** the user chooses "Show more" on the "Acme" row on November 2, 2026
- **THEN** the row also shows November 30, December 15 and December 31, 2026 paychecks with their deposits

### Requirement: Skip from the list
Each row SHALL offer "Skip next paycheck". It SHALL ask for confirmation naming the paycheck date, and on confirmation skip the next occurrence of the pay schedule and of every deposit schedule together in one undoable step, as the editor's skip does.

#### Scenario: Confirm before skipping
- **WHEN** the user chooses "Skip next paycheck" on the "Acme" row
- **THEN** the app asks "Skip the paycheck on November 13, 2026?" and nothing is skipped until the user confirms

### Requirement: Skipped paychecks are shown
When a paycheck's next occurrence has been skipped, its row SHALL show "Skipped: <date>" and show the following occurrence as the next paycheck. Undo SHALL restore the skipped occurrence.

#### Scenario: Unpaid leave is visible
- **GIVEN** the user skipped the November 13, 2026 "Acme" paycheck
- **WHEN** the user opens the Schedules page
- **THEN** the "Acme" row shows "Skipped: Friday, November 13" and Monday, November 30 as the next paycheck

### Requirement: Clearing account warning on the row
When a paycheck's clearing account warning is active (see `paychecks` "Clearing account"), its row SHALL show the warning's amount and the deposit still missing.

#### Scenario: Missing deposit on the row
- **GIVEN** the November 13, 2026 "Acme" pay posted and the "Checking" deposit never arrived
- **WHEN** the user opens the Schedules page on November 17, 2026
- **THEN** the "Acme" row warns that 2,025.00 is still in "Acme Paycheck", waiting on the "Checking" deposit

### Requirement: First paycheck
With the feature on and no paychecks, the section SHALL show "Set up a paycheck to see what lands in each account, and when." with an "Add paycheck" button that opens a new paycheck editor.

#### Scenario: Empty state
- **WHEN** the user has no paychecks and opens the Schedules page
- **THEN** the Paychecks section shows the setup line and an "Add paycheck" button
