## ADDED Requirements

### Requirement: The statement balance is never pre-filled with the cleared balance
The statement-balance field SHALL start with the first of: the bank-sync balance when its own write time is within the freshness window (a synced preference, 7 days, at most 30), a statement-derived balance, or empty with a hint. It SHALL never start with the cleared balance, one tap away as "Use cleared balance" with "Your own cleared total — not an independent check" under it. One loot-core resolver supplies web and native.

#### Scenario: A recent bank balance
- **GIVEN** an account synced yesterday with a bank balance of 465,413 cents
- **WHEN** a person opens Reconcile on desktop web, phone web or iPhone
- **THEN** the field holds that balance and its source line, not the cleared balance

#### Scenario: A balance with no recent write
- **GIVEN** `last_sync` is yesterday but the balance was last written 3 weeks ago, or its time is unknown
- **THEN** the balance is offered with its date and not pre-filled

#### Scenario: A changed window
- **GIVEN** the window is set to 14 days and the account last synced 12 days ago
- **THEN** the bank balance is the pre-fill

#### Scenario: A bad window
- **WHEN** the preference does not match `^\d+$`, is zero or is above 30
- **THEN** the default of 7 days applies

#### Scenario: A stale bank balance
- **GIVEN** an account last synced 12 days ago
- **THEN** the field is empty and "Use bank balance from {date}" is offered

#### Scenario: No source
- **GIVEN** an account with no bank sync
- **THEN** the field is empty with a hint, and Confirm is off until a value is typed or the cleared balance is chosen

### Requirement: The source of the balance is shown
A source line under the field SHALL always be visible, naming the source and its time in words with an icon, never colour alone. After an edit it SHALL read "Entered by you" with "Restore bank balance". The explanation (may include pending items; compare with your statement) is a desktop hover and focus tooltip with "Bank Sync Settings…", and a tap note on phone.

#### Scenario: Edited
- **WHEN** a person changes the pre-filled amount
- **THEN** the line reads "Entered by you" and "Restore bank balance" restores the pre-fill

#### Scenario: Desktop
- **GIVEN** the pre-filled field
- **THEN** the source line is visible without hover, and focusing the icon adds the explanation and "Bank Sync Settings…"

#### Scenario: The cleared choice
- **THEN** "Use cleared balance" shows its not-an-independent-check line

### Requirement: Confirming records the person's balance
Confirming SHALL save the sc-4793 statement balance record with the amount, source (`bank-sync` unedited, `entered` once edited, `cleared` when chosen), `as_of` and who. Leaving without confirming SHALL save nothing and lock nothing.

#### Scenario: Confirm an unedited bank balance
- **WHEN** a person confirms the pre-filled bank balance
- **THEN** a record with source `bank-sync` exists for the account

#### Scenario: Leave
- **WHEN** a person closes the flow before confirming
- **THEN** no record is saved

### Requirement: The save derives who and checks the source
The handler `account-statement-balance-save` SHALL take no `entered_by` and derive it from the signed-in user (display name, else user name, else `app`). It SHALL accept `bank-sync` only when the amount equals the resolver's bank balance, `cleared` only when it equals the live cleared balance, `entered` for any amount, and SHALL reject `statement` until something produces one.

#### Scenario: A forged bank-sync label
- **WHEN** a caller saves `bank-sync` with an amount other than the bank balance
- **THEN** the save is refused and nothing is recorded

#### Scenario: A forged cleared label
- **WHEN** a caller saves `cleared` with an amount other than the cleared balance
- **THEN** the save is refused

#### Scenario: Who
- **WHEN** a signed-in person confirms
- **THEN** the record's `entered_by` is that person's name, whatever the caller sent

#### Scenario: A statement label
- **WHEN** a caller saves `statement`
- **THEN** it is refused

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

#### Scenario: A malformed list
- **WHEN** the stored exclusions are not an array of strings
- **THEN** the checklist lists every open account

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
With `NativeScreen.reconcile` on in the native app (it ships on and Settings can turn it off), the account menu's "Reconcile…" and a banner on the Accounts tab SHALL present the native flow full-screen; with the switch off or outside the native app they SHALL open the web dialog. The banner SHALL show while an account is due and collapse to a reconciled line when none is.

#### Scenario: Menu entry
- **GIVEN** the switch is on
- **WHEN** a person chooses ••• › Reconcile… on an account
- **THEN** the native flow opens at step 1 for that account

#### Scenario: On by default
- **GIVEN** a fresh install
- **THEN** the switch is on and the menu entry opens the native flow

#### Scenario: Switch off
- **WHEN** a person turns the switch off in Settings
- **THEN** the same menu item opens the web dialog

#### Scenario: The month is done
- **WHEN** every listed account is done
- **THEN** the banner reads that the month is reconciled

### Requirement: Step 2 ticks rows against a live difference
Step 2 SHALL pin the statement, cleared and difference (from loot-core) above the rows. Tapping or swiping a row SHALL toggle cleared at once. Loot-core SHALL refuse the whole call unless every id is in the account, refuse reconciled rows and a lone split child, and tick a parent's children with it. B1 locks nothing: at 0.00 "Ready to lock — finish in the register" opens the web reconcile; otherwise "Done for now" keeps the ticks.

#### Scenario: Tick a row
- **GIVEN** a difference of 41.80
- **WHEN** a person ticks a 41.80 row
- **THEN** it is cleared, the difference reads 0.00 and VoiceOver announces it

#### Scenario: Zero difference
- **WHEN** the difference reaches 0.00
- **THEN** "Ready to lock — finish in the register" opens the web reconcile for the account, and nothing is locked by the native flow

#### Scenario: Done for now
- **GIVEN** a difference above zero
- **WHEN** a person taps "Done for now"
- **THEN** the flow closes and the ticks stay, and the checklist reads "In progress"

#### Scenario: A reconciled row
- **WHEN** a call ticks a reconciled row, from any caller
- **THEN** it does not change and is shown locked

#### Scenario: Another account's row
- **WHEN** `ids` includes a row of another account
- **THEN** the call fails and nothing changes

#### Scenario: Splits
- **WHEN** a split parent is ticked
- **THEN** its children follow, and ticking a child alone is refused

### Requirement: Step 2 has the designed controls
Step 2 SHALL offer "To tick" (uncleared rows up to today) and "All" (reconciled rows locked and dimmed), "Find amount", and press-and-hold to edit a row. A row SHALL read "…, not cleared. Double-tap to mark cleared" with an "Edit transaction" action.

#### Scenario: All
- **WHEN** a person chooses "All"
- **THEN** reconciled rows show locked and dimmed

### Requirement: The flow is accessible
The flow SHALL support Dynamic Type to AX5 without truncating an amount, announce "Step 2 of 4, Tick off" and the changing difference to VoiceOver, follow the system's light and dark appearance, and take all text through localization.

#### Scenario: Large type
- **WHEN** Dynamic Type is AX2
- **THEN** rows wrap, amounts are whole and the difference stays pinned

### Requirement: The Mac flow follows the Mac app
On Mac the flow SHALL be a sidebar destination "Reconcile" with a count badge and ⇧⌘R, steps in the content area, and a register table with Space to tick, once the Mac app exists, using the same handlers.

#### Scenario: Keyboard
- **WHEN** a person on Mac focuses a statement row and presses Space
- **THEN** its cleared state toggles and the difference updates, with the rest of the frames' keyboard flow (arrows, Return, Esc, ⌘[, ⌘F, Tab through the icon and link)
