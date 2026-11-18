## ADDED Requirements

### Requirement: The native sheet is behind a per-device switch
The iPhone app SHALL show the native Add and Edit transaction sheet only while the switch `NativeScreen.addTransaction` is on. While it is off, adding and editing SHALL open the web form exactly as before. Once the screen has passed its Simulator review, an unset switch SHALL read as on, and web Settings › Native screens SHALL show a toggle that turns it off.

#### Scenario: Switch off
- **GIVEN** the iPhone app with `NativeScreen.addTransaction` stored as false
- **WHEN** the person taps Add in the tab bar
- **THEN** the web form for a new transaction opens, as before this change

#### Scenario: Unset after the default flips
- **GIVEN** the iPhone app on a release where the default has flipped, with the switch never set
- **WHEN** the person taps Add
- **THEN** the native sheet opens

#### Scenario: Turning it off in Settings
- **GIVEN** the native sheet is on
- **WHEN** the person turns off the toggle in Settings › Native screens and taps Add
- **THEN** the web form opens

### Requirement: Every entry point opens the native sheet
While the switch is on, the iPhone app SHALL open the native sheet from the Add tab, from a tap on a native register row (edit), and from a page route to `/transactions/new` or `/transactions/<id>`. Add from inside an account's native register SHALL preset that account.

#### Scenario: Add from a register
- **GIVEN** the native register of "Checking" is on screen
- **WHEN** the person taps Add
- **THEN** the native sheet opens for a new transaction with account "Checking"

#### Scenario: Edit from a register row
- **WHEN** the person taps a row in a native register
- **THEN** the native sheet opens in edit mode for that transaction, not the web editor

#### Scenario: A page route to a transaction
- **WHEN** the page navigates to `/transactions/<id>` for a live transaction
- **THEN** the native sheet opens in edit mode over the current screen

### Requirement: Saving stores what the web form stores
On iPhone, a transaction added or edited in the native sheet SHALL be stored exactly as the web form would store it from the same input, including payee, category, account, date, notes, cleared, splits and transfers, with rules applied as the web form applies them. A save SHALL be one undo step and all or nothing.

#### Scenario: Same input, same row
- **GIVEN** the same budget, rules and input entered once in the web form and once in the native sheet
- **WHEN** both are saved
- **THEN** the stored transactions are equal in every field except their ids

#### Scenario: A failed save writes nothing
- **GIVEN** a split whose second child's category was deleted on another device
- **WHEN** the person saves
- **THEN** nothing is stored, the sheet stays open with the draft, and the error shows on that child

#### Scenario: Undo after save
- **WHEN** the person saves and then taps Undo in the toast
- **THEN** the transaction, its children, any new payee and any transfer partner are removed as one step

### Requirement: Rules fill the form as the web form does
On iPhone, while adding, the sheet SHALL show the rules' result after each field commit, as the web form does. A payee change SHALL apply every field the rules set; other changes SHALL fill only empty fields and notes. A field the person cleared SHALL stay empty. Editing a saved transaction SHALL run no rules.

#### Scenario: A payee rule fills the category
- **GIVEN** a rule "payee is Costco → category Groceries"
- **WHEN** the person picks payee Costco on a new transaction
- **THEN** the category shows Groceries before saving

#### Scenario: A cleared field stays cleared
- **GIVEN** the rule above, and the person then clears the category
- **WHEN** the person changes the amount
- **THEN** the category stays empty

#### Scenario: Editing runs no rules
- **GIVEN** a saved transaction with payee Costco and category Dining
- **WHEN** the person edits its amount
- **THEN** the category stays Dining

### Requirement: A rule's change is shown and can be undone
On iPhone, a field filled by a rule SHALL read "Set by a rule" in words and to VoiceOver. The person's edit to it SHALL be kept until the next payee change. When a payee change replaces fields the person set by hand, the sheet SHALL name them and offer Restore, which puts back their values and is announced to VoiceOver.

#### Scenario: The indicator
- **GIVEN** a rule "payee is Costco → category Groceries"
- **WHEN** the person picks Costco on a new transaction
- **THEN** the category shows Groceries with "Set by a rule", and VoiceOver reads "Category, Groceries, set by a rule"

#### Scenario: The person's override is kept
- **GIVEN** the rule filled Groceries
- **WHEN** the person picks Dining and then changes the amount
- **THEN** the category stays Dining without the indicator

#### Scenario: Restore after a payee change
- **GIVEN** the person chose Dining by hand
- **WHEN** they change the payee to Costco and the rule sets Groceries
- **THEN** the sheet says the category was changed by a rule, and Restore puts back Dining

#### Scenario: A rule changed before saving
- **GIVEN** the sheet showed Groceries, then the rule was edited on another device
- **WHEN** the person saves
- **THEN** nothing is stored, the sheet says "Rules changed this; check and save again.", shows the rule's new result with "Set by a rule", and the person saves again

### Requirement: Amount entry with sign and arithmetic
On iPhone, the amount field SHALL accept a number or an arithmetic expression with + − × ÷ in the budget's number format; Expense, Income, or a transfer's direction SHALL set the sign. The engine SHALL evaluate the expression; the sheet SHALL show the result and SHALL never compute money itself. An expression that does not evaluate SHALL show an inline error and block saving.

#### Scenario: An expression
- **GIVEN** a budget with number format `1,000.33`
- **WHEN** the person types `12.50+3*2` as an Expense
- **THEN** the sheet shows −18.50 and saves −1850 minor units

#### Scenario: Inflow
- **WHEN** the person types `200` and chooses Income
- **THEN** the saved amount is +20000 minor units

#### Scenario: Not a number
- **WHEN** the person types `12..5`
- **THEN** the field shows "Enter an amount" and Save is disabled

### Requirement: Pickers show the budget's own data
On iPhone, the payee picker SHALL search the budget's payees, favourites first, offer to create a typed name, and list open accounts other than the transaction's as Transfers. The category picker SHALL list the non-hidden categories by group. The account picker SHALL list open accounts. All three SHALL come from the engine.

#### Scenario: Searching payees
- **GIVEN** payees "Costco", "Cost Plus" and "Target"
- **WHEN** the person types "cos"
- **THEN** the picker lists Costco and Cost Plus, and a "Create “cos”" row

#### Scenario: Creating a payee
- **WHEN** the person picks "Create “Corner Bakery”" and saves
- **THEN** the payee "Corner Bakery" exists and the transaction uses it

#### Scenario: Choosing a transfer
- **GIVEN** a new transaction in Checking
- **WHEN** the person picks Savings under Transfers and saves 100 as Outflow
- **THEN** Checking has −100 and Savings has +100, linked as a transfer

### Requirement: Transfer is its own choice
On iPhone, the sheet SHALL offer Expense, Income and Transfer. Transfer SHALL replace Payee with a To account row (open accounts other than this one) and a direction (out of or into this account), and SHALL be stored through the destination's transfer payee. Picking a transfer payee SHALL select Transfer; leaving Transfer SHALL clear To account.

#### Scenario: A transfer out
- **GIVEN** a new transaction in Checking
- **WHEN** the person chooses Transfer, To account Savings, out of Checking, and 100
- **THEN** Checking has −100 and Savings has +100, linked as a transfer, and no Payee row was shown

#### Scenario: Picking a transfer payee
- **WHEN** the person picks Savings under Transfers in the payee picker
- **THEN** the control shows Transfer with To account Savings

#### Scenario: Back to Expense
- **GIVEN** Transfer with To account Savings
- **WHEN** the person chooses Expense
- **THEN** the Payee row returns empty and no transfer is saved

### Requirement: Category follows the account and transfer rules
On iPhone, the sheet SHALL hide the category, saying why in words, for a transaction in an off-budget account and for a transfer between two on-budget or two off-budget accounts. A transfer between an on-budget and an off-budget account SHALL show the category only on the on-budget side.

#### Scenario: Off-budget account
- **WHEN** the person sets the account to an off-budget account
- **THEN** the category row reads "Off-budget accounts don't use categories" and no category is saved

#### Scenario: On-budget transfer
- **WHEN** the person picks an on-budget account under Transfers from an on-budget account
- **THEN** the category row reads "Transfers between budget accounts don't use categories"

#### Scenario: Transfer to an off-budget account
- **GIVEN** a new transaction in on-budget Checking
- **WHEN** the person chooses Transfer to off-budget Brokerage
- **THEN** the Category row shows and its category is saved on the Checking side

### Requirement: The category picker
On iPhone, the category picker SHALL list the form read's non-hidden categories by group, filter them by a typed search, offer Uncategorized first (no category), and tick the current category by id. If re-reading the categories fails, it SHALL keep the last list and show an error with Retry.

#### Scenario: Search
- **WHEN** the person types "groc" in the category picker
- **THEN** only categories whose names contain "groc" are listed, under their groups

#### Scenario: Uncategorized
- **WHEN** the person picks Uncategorized and saves
- **THEN** the transaction has no category

#### Scenario: Tick by id
- **GIVEN** two categories named "Fees" in different groups, and the transaction uses the second
- **THEN** only the second "Fees" is ticked

#### Scenario: Re-read fails
- **GIVEN** a category was added on another device and the re-read fails
- **THEN** the picker keeps its list and shows an error with Retry

### Requirement: An unchecked field does not block saving
On iPhone, when a preview times out the sheet SHALL retry it once by itself and once when the app returns to the foreground, then show "Couldn't check this yet." with Check Again. Save SHALL stay allowed; the server re-runs the rules and validation and refuses a wrong draft, so nothing unchecked is stored silently.

#### Scenario: Retry succeeds
- **GIVEN** the first preview times out
- **WHEN** the automatic retry answers
- **THEN** the field shows the checked value and no warning

#### Scenario: Still unchecked
- **GIVEN** both the first preview and the retry time out
- **THEN** the field shows "Couldn't check this yet." with Check Again, and Save is enabled

#### Scenario: Saving an unchecked draft that a rule changes
- **GIVEN** an unchecked field, and a rule that would change the category
- **WHEN** the person saves
- **THEN** nothing is stored, and the sheet shows the rule's result to check and save again

### Requirement: Splits keep their remainder from the engine
On iPhone, the sheet SHALL let the person split a transaction into children, each with amount, category, payee and notes, up to the limit `transaction-split-max-children`. The sheet SHALL show the engine's remaining amount in words and SHALL block saving until the children sum to the parent.

#### Scenario: Left to split
- **GIVEN** a parent of −100.00 with one child of −60.00
- **THEN** the sheet reads "$40.00 left to split" and Save is disabled

#### Scenario: Balanced
- **WHEN** the person adds a second child of −40.00
- **THEN** the remainder line clears and Save is enabled

#### Scenario: At the limit
- **GIVEN** `transaction-split-max-children` is 50 and the split has 50 children
- **THEN** "Add split" is disabled and says the limit is 50

### Requirement: A changed transaction is not overwritten
On iPhone, saving an edit SHALL fail with "This transaction changed on another device" when the transaction, any of its children, or any transfer partner changed after the sheet read it. Nothing SHALL be written. Reload SHALL keep the person's edits, take the new values for fields they did not edit, and list each field changed in both places with "Use theirs".

#### Scenario: Edited elsewhere
- **GIVEN** the sheet is open on a transaction, and a sync changes its notes
- **WHEN** the person saves an amount change
- **THEN** nothing is written and the sheet shows the changed-elsewhere message with Reload

#### Scenario: Partner changed
- **GIVEN** a transfer is open, and a sync changes the partner row's date
- **WHEN** the person saves
- **THEN** nothing is written and the same message shows

#### Scenario: Reload keeps typed work
- **GIVEN** the person changed the amount, and another device changed the notes
- **WHEN** the person taps Reload
- **THEN** the amount keeps the person's value, the notes show the other device's value, and nothing is listed

#### Scenario: Both changed the same field
- **GIVEN** the person changed the notes, and another device also changed the notes
- **WHEN** the person taps Reload
- **THEN** the notes keep the person's text, the list shows both texts with "Use theirs", and saving uses the new digest

#### Scenario: Use theirs
- **WHEN** the person taps "Use theirs" on the notes
- **THEN** the notes show the other device's text

### Requirement: Text comes from the approved copy table
On iPhone, every user-facing string in the sheet SHALL be a localized string whose exact text comes from the Designer's copy table once the Product Owner approves it; wording quoted in this spec is illustrative until then. Text SHALL say the cause and what to do in plain words, with no codes.

#### Scenario: A hard-coded string
- **WHEN** a user-facing string in the sheet is not a localized string
- **THEN** the localization test fails

#### Scenario: No codes shown
- **WHEN** a save is refused with `[native:invalid-draft:notes-too-long]`
- **THEN** the sheet shows plain words for the notes field and no code

### Requirement: Reconciled rows ask first
On iPhone, saving or deleting a transaction SHALL first ask the person to confirm when any row it would touch is reconciled, children and transfer partners included, and a row inside a reconciled split counts as reconciled. The dialog SHALL name each affected account. Without that confirmation, nothing SHALL be written.

#### Scenario: Reconciled transfer partner
- **GIVEN** a transfer whose partner in Savings is reconciled
- **WHEN** the person saves an amount change
- **THEN** a dialog names Savings, and the save happens only after Confirm

#### Scenario: Cancelled
- **WHEN** the person taps Cancel in that dialog
- **THEN** nothing is written and the sheet keeps the draft

### Requirement: Delete from the edit sheet
On iPhone, the edit sheet SHALL offer Delete, which asks first and deletes the transaction with its children and transfer partners as one undo step. For a transfer, the dialog SHALL name the partner's account, say when that account is closed, say both sides are deleted, and say Undo restores both.

#### Scenario: Partner in a closed account
- **GIVEN** a transfer whose partner is in the closed account "Old Savings"
- **WHEN** the person taps Delete
- **THEN** the dialog names "Old Savings (closed)", says both sides are deleted and that Undo restores both

#### Scenario: Deleting a split transfer
- **GIVEN** a split with one child that is a transfer to Savings
- **WHEN** the person taps Delete and confirms
- **THEN** the parent, its children and the Savings partner are gone, and Undo restores all of them

### Requirement: A save that does not finish can be retried safely
On iPhone, when a save or delete times out, the sheet SHALL say it did not finish, keep the draft and offer Retry. A retry SHALL never store the transaction twice, even after the app reloads its engine.

#### Scenario: Timeout then Retry
- **GIVEN** the first save reached the engine but its answer timed out
- **WHEN** the person taps Retry
- **THEN** exactly one transaction exists and the sheet closes

#### Scenario: Retry after the app was suspended
- **GIVEN** a save landed, then iOS suspended the app and the engine reloaded before the answer arrived
- **WHEN** the person taps Retry
- **THEN** exactly one transaction exists

### Requirement: A missing transaction says so
On iPhone, when the sheet cannot read a transaction because it was deleted or its account was closed, the sheet SHALL say "This transaction is no longer available" with Close, and SHALL write nothing.

#### Scenario: Deleted elsewhere
- **GIVEN** a transaction deleted on another device
- **WHEN** the person opens it from a register that has not refreshed yet
- **THEN** the sheet shows that it is no longer available

### Requirement: Schedules and documents hand off until their native screens ship
On iPhone, the edit sheet SHALL show a linked schedule's name, read-only. Until native screens replace them, "Make recurring" and "Add document" SHALL open the web editor for the saved transaction. A transaction being added SHALL say documents can be added after saving.

#### Scenario: Make recurring
- **GIVEN** a saved transaction with no schedule
- **WHEN** the person taps Make recurring
- **THEN** the web editor for that transaction opens, and closing it returns to the native screen

#### Scenario: Documents on a new transaction
- **WHEN** the person opens the native sheet to add a transaction
- **THEN** the Documents row reads that documents can be added once it is saved

### Requirement: Hardware keyboard entry
On iPhone with a hardware keyboard, the sheet SHALL accept typed amounts and expressions, move focus with Tab and Shift-Tab in field order, filter pickers by typing and choose with Return, save with Cmd-Return, cancel with Esc (asking first when changed) and delete with Cmd-Delete (confirmed).

#### Scenario: Keyboard-only add
- **GIVEN** an iPhone with a hardware keyboard and the native sheet open
- **WHEN** the person types `42.10`, Tab, "cost", Return, Tab, "groc", Return, then Cmd-Return
- **THEN** the transaction is saved with amount −42.10, payee Costco and category Groceries

#### Scenario: Esc with changes
- **WHEN** the person has typed an amount and presses Esc
- **THEN** the sheet asks whether to discard the transaction

### Requirement: VoiceOver and Dynamic Type
On iPhone, every field SHALL read its label, value and any error to VoiceOver; the amount SHALL read as currency with its direction; the split remainder SHALL be announced when it changes. At every Dynamic Type size up to AX5 the amount SHALL not truncate and labels SHALL stack above values. Errors SHALL never be shown by colour alone.

#### Scenario: VoiceOver on the amount
- **GIVEN** VoiceOver is on and the amount is −18.50
- **WHEN** focus reaches the amount field
- **THEN** VoiceOver reads "Amount, outflow, 18 dollars 50"

#### Scenario: AX5
- **GIVEN** the text size is AX5
- **THEN** a split of 4 children shows every amount in full, without horizontal scrolling
