# Spec Delta

## MODIFIED Requirements

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
