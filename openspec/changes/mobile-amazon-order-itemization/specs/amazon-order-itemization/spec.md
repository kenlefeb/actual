# Spec Delta

## ADDED Requirements

### Requirement: Import Amazon orders on the phone
When the Amazon order itemization flag is on, the phone's All Accounts menu SHALL offer "Import Amazon orders". It SHALL open the phone's file picker, and the chosen export SHALL be read and parsed on the device under the same rules as on desktop. When the flag is off, the phone SHALL offer no way to import Amazon orders.

#### Scenario: Hidden on the phone when the feature is off
- **WHEN** the Amazon order itemization flag is off and the user opens the All Accounts menu on the phone
- **THEN** it offers no "Import Amazon orders"

#### Scenario: Offered on the phone when the feature is on
- **WHEN** the flag is on and the user opens the All Accounts menu on the phone
- **THEN** it offers "Import Amazon orders", and choosing it opens the phone's file picker

#### Scenario: Not an order export on the phone
- **WHEN** the user picks a bank CSV instead of an Amazon order export on the phone
- **THEN** the import is refused with the same message as on desktop, listing the missing order fields, and no review opens

#### Scenario: Import stays on the phone
- **WHEN** the user imports an order export on the phone and closes the review without applying
- **THEN** no request was sent to Amazon or any other service, and no transaction in the budget has changed

### Requirement: Phone review
The phone SHALL show the review full screen, with the charges in the desktop groups and order: Matched, Ambiguous, Not matched, Not matched: paid partly by gift card or points, Already split, and Already itemized. Each charge SHALL show its order id, ship date, amount and items. A charge with a transaction SHALL also show that transaction's account, date and payee, and "Reconciled" when it is reconciled.

#### Scenario: Matched charge on the phone
- **GIVEN** a $32.40 charge shipped November 4 and a −$32.40 "AMZN Mktp US" card transaction on November 6
- **WHEN** the user imports the export on the phone
- **THEN** the Matched group shows the charge's order id, ship date, $32.40 and its items, with the transaction's account, November 6 and "AMZN Mktp US"

#### Scenario: Reconciled match on the phone
- **GIVEN** a charge matched to a reconciled transaction
- **WHEN** the review opens on the phone
- **THEN** its card is marked "Reconciled"

### Requirement: Apply Matched charges on the phone
On the phone, each Matched charge SHALL offer "Apply" for that charge alone, and the review SHALL offer "Apply all" for every Matched charge not yet applied. Each apply SHALL be one undoable step with the desktop apply behavior, and SHALL show a notification with Undo. Undo SHALL restore the transactions and make those charges applicable again. A charge that apply skips SHALL show the desktop reason why it wasn't applied.

#### Scenario: Apply one charge on the phone
- **GIVEN** a review with three Matched charges
- **WHEN** the user taps "Apply" on one of them
- **THEN** only that charge's transaction is itemized, its card shows it was applied, and the other two can still be applied

#### Scenario: Apply all on the phone
- **GIVEN** a review with three Matched charges
- **WHEN** the user taps "Apply all"
- **THEN** all three transactions are itemized in one step

#### Scenario: Undo on the phone
- **WHEN** the user taps "Apply all" for three Matched charges and then taps Undo in the notification
- **THEN** all three transactions are back to how they were, and their cards can be applied again

#### Scenario: Only the latest apply offers Undo on the phone
- **WHEN** the user applies one charge, then applies another
- **THEN** only the second apply offers Undo, and Undo restores only the second charge

#### Scenario: Apply all after a skip on the phone
- **GIVEN** a Matched charge that an earlier apply skipped
- **WHEN** the user taps "Apply all"
- **THEN** that charge is not sent again, and it keeps showing why it wasn't applied

#### Scenario: Close without applying on the phone
- **WHEN** the user imports an export with Matched charges on the phone and closes the review without applying
- **THEN** no transaction in the budget has changed

#### Scenario: Changed after the review, on the phone
- **GIVEN** a Matched charge whose transaction was split on another device after the review opened
- **WHEN** the user applies it on the phone
- **THEN** it is not applied, and its card shows that it was split after the review

### Requirement: Other groups are read-only on the phone
On the phone, Ambiguous, Not matched, gift card or points, Already split and Already itemized charges SHALL offer no apply and no transaction choice. Each of those groups SHALL show a "Resolve on desktop" hint; the Ambiguous hint SHALL say that its transaction is chosen on desktop.

#### Scenario: Ambiguous charge on the phone
- **GIVEN** a $25.00 charge with two equal −$25.00 "Amazon.com" candidates
- **WHEN** the review opens on the phone
- **THEN** the charge is in the Ambiguous group with no apply and no choice of transaction, and the group says to choose its transaction on desktop

#### Scenario: Gift card charge on the phone
- **GIVEN** an order paid partly by a gift card
- **WHEN** the review opens on the phone
- **THEN** its charges are listed under "Not matched: paid partly by gift card or points", can't be applied, and the group shows "Resolve on desktop"
