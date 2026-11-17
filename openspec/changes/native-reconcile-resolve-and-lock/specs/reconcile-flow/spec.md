## ADDED Requirements

### Requirement: Step 2 continues to the lock
At a difference of zero, step 2 SHALL continue to step 4 in the native flow, replacing the "finish in the register" exit. Above zero it SHALL continue to step 3 and keep "Done for now".

#### Scenario: Zero difference
- **WHEN** the difference reaches 0.00 in step 2
- **THEN** a success haptic plays and the flow moves to step 4

#### Scenario: A difference remains
- **WHEN** a person taps Continue with a difference above zero
- **THEN** step 3 opens

### Requirement: Step 3 offers likely matches first
Step 3 SHALL list, from one loot-core read, at most the results limit of matches: a row equal to the difference, two rows summing to it, and a cleared row equal to its negative, nearest date first, each tappable to tick or untick. The difference SHALL update as rows change.

#### Scenario: A same-amount row
- **GIVEN** a difference of 41.80 and an uncleared row of 41.80
- **THEN** it is the first match, and ticking it ends step 3

#### Scenario: Two rows
- **GIVEN** a difference of 41.80 and uncleared rows of 30.00 and 11.80
- **THEN** they are offered as one match

### Requirement: Step 3 can search
Step 3 SHALL search the account's rows by amount, payee or notes, and for an amount also the amounts with two adjacent digits swapped, in loot-core.

#### Scenario: Swapped digits
- **WHEN** a person searches 41.80
- **THEN** rows of 41.08 and 48.10 are found too

### Requirement: The missing transaction is added in the add form
"Add the missing transaction" SHALL open the add-transaction form with the account and the difference filled in, which needs an `amount` parameter on that form, and the flow SHALL close to the checklist showing the account In progress.

#### Scenario: Add with the amount
- **WHEN** a person taps it with a difference of 41.80
- **THEN** the add form opens for that account with 41.80 filled in

### Requirement: An adjustment is a person's confirmed action
An adjustment SHALL be created only after a sheet naming the amount in its button, and only by a native handler that requires the amount to equal the live difference. It SHALL be created as the app creates it (cleared, dated today, notes, rules run, an explicit category winning), never by an `api/` handler or the MCP reconcile tool.

#### Scenario: The confirm sheet
- **WHEN** a person asks for an adjustment of 41.80
- **THEN** a sheet shows "Add +$41.80 adjustment" and nothing is created until they confirm

#### Scenario: A stale amount
- **GIVEN** the difference changed after the sheet opened
- **WHEN** the person confirms
- **THEN** the call fails and no transaction is created

#### Scenario: Remove it before locking
- **WHEN** a person removes the adjustment in step 4 while it is the last undoable write
- **THEN** it is deleted and the difference returns

### Requirement: Step 4 lists what locks
Step 4 SHALL show the number of rows it locks (this account's cleared, unreconciled rows with their split children), the linked transfer rows in other accounts that are listed and not locked, the balance on record with its source and time, and the note that locked rows unlock only in the app. The button SHALL carry the count.

#### Scenario: A transfer leg
- **GIVEN** 17 rows to lock, 2 of them transfers
- **THEN** the button reads "Lock 17 transactions" and the 2 other legs are listed as not locked

#### Scenario: A long list
- **GIVEN** more rows than the list limit
- **THEN** the list is cut with a count, and the button count is exact

### Requirement: The lock is the app's and the MCP's lock
The native lock SHALL select rows with one loot-core function whose result equals the app's lock and the MCP's selection on the same account, and SHALL lock only that set.

#### Scenario: Parity
- **GIVEN** one fixture with splits, a reconciled parent with an unreconciled child and transfers
- **THEN** the native, MCP and web selections are the same

### Requirement: The lock consumes the record and is verified
The lock SHALL require an unconsumed, unexpired record and a zero difference, lock in one batch, re-read the balance, consume the record whenever rows locked, and stamp `last_reconciled` only when verified. An unverified lock SHALL say the rows are locked and the balance moved.

#### Scenario: A verified lock
- **WHEN** a person locks and the balance still matches
- **THEN** the rows are reconciled, the record is consumed and `last_reconciled` is stamped

#### Scenario: An unverified lock
- **WHEN** a cleared row arrives during the lock
- **THEN** the rows stay locked, the record is consumed, no stamp is set and the screen says to review

### Requirement: The lock is bound to what was shown
The lock SHALL take only an account id and the preview's `plan_digest`, refuse when the recomputed digest differs, and not be undoable through the bridge.

#### Scenario: The account changed
- **WHEN** a row is cleared after the preview
- **THEN** the lock is refused and nothing changed

#### Scenario: No undo
- **WHEN** `native/undo` is called after a lock
- **THEN** the rows stay locked

### Requirement: Done returns to the checklist
After a lock the flow SHALL show the account reconciled with the statement balance and locked count, announce it, and offer the next due account or the checklist, where the account reads Done.

#### Scenario: The next account
- **GIVEN** another account is due
- **THEN** the done screen offers it

### Requirement: Steps 3 and 4 limits are settings
The match candidates (300), match results (5) and lock list rows (200) limits SHALL be synced preferences, valid only as whole numbers matching `^\d+$` within ceilings of 2,000, 20 and 2,000, else the default.

#### Scenario: A bad value
- **WHEN** the match results preference is `1e1`
- **THEN** the default of 5 applies
