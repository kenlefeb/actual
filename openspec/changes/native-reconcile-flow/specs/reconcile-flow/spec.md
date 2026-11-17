## ADDED Requirements

### Requirement: The statement balance is never pre-filled with the cleared balance
The reconcile statement-balance field SHALL start with the first of: the account's bank-sync balance when `last_sync` is within the freshness window, a statement-derived balance, or empty with a hint. The window SHALL be a synced preference, 7 days by default, at most 30. It SHALL never start with the cleared balance, which SHALL stay one tap away as "Use cleared balance". One loot-core resolver SHALL supply this to web and native.

#### Scenario: A recent bank balance
- **GIVEN** an account synced yesterday with a bank balance of 465,413 cents
- **WHEN** a person opens Reconcile on desktop web, phone web or iPhone
- **THEN** the field holds that balance and its source line, not the cleared balance

#### Scenario: A changed window
- **GIVEN** the window is set to 14 days and the account last synced 12 days ago
- **THEN** the bank balance is the pre-fill

#### Scenario: A bad window
- **WHEN** the preference is zero, not a whole number or above 30
- **THEN** the default of 7 days applies

#### Scenario: A stale bank balance
- **GIVEN** an account last synced 12 days ago
- **THEN** the field is empty and "Use bank balance from {date}" is offered

#### Scenario: No source
- **GIVEN** an account with no bank sync
- **THEN** the field is empty with a hint, and Confirm is off until a value is typed or the cleared balance is chosen

### Requirement: The source of the balance is shown
A source line under the field SHALL name the source and its time in words, with an icon and never colour alone. After the person edits the amount it SHALL read "Entered by you" with "Restore bank balance". Desktop shows it as a hover and focus tooltip with a "Bank Sync Settings…" link; phone and iPhone as a note on tap.

#### Scenario: Edited
- **WHEN** a person changes the pre-filled amount
- **THEN** the line reads "Entered by you" and "Restore bank balance" restores the pre-fill

#### Scenario: Desktop
- **WHEN** a person focuses the information icon
- **THEN** the tooltip names the source and offers "Bank Sync Settings…"

### Requirement: Confirming records the person's balance
Confirming SHALL save the sc-4793 statement balance record with the amount, source (`bank-sync` unedited, `entered` once edited, `cleared` when chosen), `as_of` and who. Leaving without confirming SHALL save nothing and lock nothing.

#### Scenario: Confirm an unedited bank balance
- **WHEN** a person confirms the pre-filled bank balance
- **THEN** a record with source `bank-sync` exists for the account

#### Scenario: Leave
- **WHEN** a person closes the flow before confirming
- **THEN** no record is saved

### Requirement: A confirmed cleared balance says why the assistant cannot use it
When the person confirms a balance whose source is `cleared`, the app SHALL say at once, in fixed text, that the cleared balance is the app's own figure, not a statement, so an assistant cannot use it, and that entering the statement's balance lets it. The text SHALL NOT block the person's own reconcile.

#### Scenario: The cleared balance
- **WHEN** a person taps "Use cleared balance" and confirms
- **THEN** the note shows and the person's own reconcile continues

### Requirement: Reconcile this month lists all open accounts
The checklist SHALL list every open account not on the person's exclusion list, grouped Ready to confirm, Due and Done, each row with a symbol and a status word. An Edit List control SHALL remove accounts one at a time and re-add them, and the exclusions SHALL be a synced preference.

#### Scenario: The default
- **GIVEN** 6 open accounts and no exclusions
- **THEN** all 6 are listed, and a new account appears without any setting

#### Scenario: Edit List syncs
- **WHEN** a person removes an account on one device
- **THEN** it is missing from the checklist on their other devices until re-added

#### Scenario: In progress
- **GIVEN** an account with an unexpired recorded balance
- **THEN** its row reads "In progress"

### Requirement: Ready to confirm shows only with a nudge
The Ready to confirm group SHALL list only accounts an assistant has flagged ready, and SHALL NOT show while no flag exists.

#### Scenario: No nudge source
- **WHEN** no account carries an assistant flag
- **THEN** the group is not shown and Due and Done still are

### Requirement: The iPhone flow opens from the account menu and the Accounts banner
With `NativeScreen.reconcile` on in the native app, the account menu's "Reconcile…" and a banner on the Accounts tab SHALL present the native flow full-screen; with the switch off or outside the native app they SHALL open the web dialog. The banner SHALL show while an account is due and collapse to a reconciled line when none is.

#### Scenario: Menu entry
- **GIVEN** the switch is on
- **WHEN** a person chooses ••• › Reconcile… on an account
- **THEN** the native flow opens at step 1 for that account

#### Scenario: Switch off
- **WHEN** the switch is off
- **THEN** the same menu item opens the web dialog

#### Scenario: The month is done
- **WHEN** every listed account is done
- **THEN** the banner reads that the month is reconciled

### Requirement: Step 2 ticks rows against a live difference
Step 2 SHALL show the statement balance, the cleared balance and the difference, computed by loot-core and pinned above the rows. Tapping a row or swiping SHALL toggle cleared and save at once, refuse a reconciled row, and update the difference. Nothing SHALL lock before step 4.

#### Scenario: Tick a row
- **GIVEN** a difference of 41.80
- **WHEN** a person ticks a 41.80 row
- **THEN** it is cleared, the difference reads 0.00 and VoiceOver announces it

#### Scenario: A reconciled row
- **WHEN** a person taps a reconciled row
- **THEN** it does not change and is shown locked

### Requirement: The flow is accessible
The flow SHALL support Dynamic Type to AX5 without truncating an amount, announce "Step 2 of 4, Tick off" and the changing difference to VoiceOver, follow the system's light and dark appearance, and take all text through localization.

#### Scenario: Large type
- **WHEN** Dynamic Type is AX2
- **THEN** rows wrap, amounts are whole and the difference stays pinned

### Requirement: The Mac flow follows the Mac app
On Mac the flow SHALL be a sidebar destination "Reconcile" with a count badge and ⇧⌘R, steps in the content area, and a register table with Space to tick, once the Mac app exists, using the same handlers.

#### Scenario: Keyboard
- **WHEN** a person on Mac focuses a statement row and presses Space
- **THEN** its cleared state toggles and the difference updates
