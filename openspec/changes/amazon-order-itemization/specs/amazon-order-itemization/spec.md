# Spec Delta

## Purpose

Lets the user import Amazon's order-history export and itemize the matching card charges in the budget. The user reviews the matches, and each applied match becomes a split with one line per item, so Amazon purchases can be budgeted by what was bought.

## ADDED Requirements

### Requirement: Behind an experimental flag
Amazon order itemization SHALL be available only when its experimental feature flag is on. The flag SHALL be off by default.

#### Scenario: Hidden when the feature is off
- **WHEN** the Amazon order itemization flag is off
- **THEN** the app offers no way to import Amazon orders

#### Scenario: Offered when the feature is on
- **WHEN** the user turns the flag on in Experimental settings
- **THEN** the accounts page offers "Import Amazon orders"

### Requirement: Import an order export on the device
The app SHALL import Amazon's order-history export as a file the user chooses. It SHALL read and parse it on the user's device, make no network request for it, ask for no Amazon credentials, and keep neither the raw file nor its rows after the review closes.

#### Scenario: Import stays on the device
- **WHEN** the user imports an order export and closes the review without applying anything
- **THEN** no request was sent to Amazon or any other service, and the budget holds no trace of the export

### Requirement: Required order fields
An imported file SHALL provide, for each item, the order id, ship or charge date, item name, quantity, item price, tax, shipping and discounts, and payment method. A file without these fields SHALL be rejected with a message naming the missing ones, and nothing SHALL be matched.

#### Scenario: Not an order export
- **WHEN** the user imports a bank CSV instead of an Amazon order export
- **THEN** the import is refused with a message that lists the missing order fields, and no review opens

### Requirement: One charge per shipment
The app SHALL group an order's items by shipment into charges. A charge's amount SHALL be its items' prices plus their tax and shipping, minus their discounts, in the budget's currency units.

#### Scenario: Split shipment
- **GIVEN** order 111-0000001 ships a $12.00 book (tax $0.96) on November 2 and a $30.00 lamp (tax $2.40) on November 4, with free shipping
- **WHEN** the export is imported
- **THEN** the review shows two charges for 111-0000001: $12.96 shipped November 2 and $32.40 shipped November 4

### Requirement: Match by amount and date
A charge SHALL match an expense transaction of exactly its amount, dated from one day before to five days after its ship date. The transaction SHALL be in an on-budget account, not deleted, and not already split or a split line. Off-budget accounts SHALL NOT be searched.

#### Scenario: Already split by hand
- **GIVEN** a $32.40 charge shipped November 4, and the only −$32.40 transaction on November 5 was already split by the user
- **WHEN** the export is imported
- **THEN** the charge is not matched to it, and the user's split is untouched

#### Scenario: Charge posts two days after shipping
- **GIVEN** a $32.40 charge shipped November 4 and a −$32.40 "AMZN Mktp US" card transaction on November 6
- **WHEN** the export is imported
- **THEN** the review shows the charge matched to that transaction, with its account, date, amount and payee

#### Scenario: Outside the date window
- **GIVEN** a $32.40 charge shipped November 4 and the only −$32.40 transaction is dated November 10
- **WHEN** the export is imported
- **THEN** the charge is not matched

### Requirement: Payee ranks candidates
When several transactions fit a charge, the app SHALL prefer one whose payee or imported payee looks like Amazon, then the date nearest the ship date. If two candidates remain equally ranked, the charge SHALL be shown as ambiguous, and the user SHALL choose its transaction or leave it unmatched.

#### Scenario: Two equal candidates
- **GIVEN** a $25.00 charge shipped November 3, and two −$25.00 "Amazon.com" transactions on November 4 in different card accounts
- **WHEN** the export is imported
- **THEN** the charge is shown as ambiguous with both transactions, and neither is chosen until the user picks one

#### Scenario: Payee is a hint, not a filter
- **GIVEN** a $40.00 charge shipped November 5, and the only −$40.00 transaction on November 6 has payee "CARD PURCHASE 1234"
- **WHEN** the export is imported
- **THEN** the charge is matched to that transaction

### Requirement: One transaction per charge
A transaction SHALL be matched to at most one charge in a review. When two charges have the same amount and dates, each SHALL get a different transaction or be shown as ambiguous.

#### Scenario: Two same-day orders of the same amount
- **GIVEN** two $15.00 charges shipped November 2, and one −$15.00 Amazon transaction on November 3
- **WHEN** the export is imported
- **THEN** the transaction is not matched to both: both charges are shown as ambiguous with that transaction as a candidate

### Requirement: Gift cards and points are not matched
A charge from an order paid in whole or in part by a gift card, gift certificate or points SHALL be shown in the review as "Not matched: paid partly by gift card or points". It SHALL never be applied, and never left out of the review.

#### Scenario: Order paid partly by a gift card
- **GIVEN** order 111-0000002 lists a gift card among its payment methods
- **WHEN** the export is imported
- **THEN** its charges appear as "Not matched: paid partly by gift card or points" and can't be applied

### Requirement: Unmatched charges are listed
A charge with no candidate transaction SHALL appear in the review as not matched, with its order id, ship date, amount and items, so the user can see that nothing was found.

#### Scenario: Paid with a card that isn't in the budget
- **GIVEN** a $60.00 charge shipped November 1, and no −$60.00 transaction in any on-budget account from October 31 to November 6
- **WHEN** the export is imported
- **THEN** the review lists the charge as not matched

### Requirement: Nothing is written until applied
Importing and reviewing SHALL NOT change the budget. Only the user applying a match, for one charge or for all selected matches, SHALL write to the budget.

#### Scenario: Close the review
- **WHEN** the user imports an export with ten matched charges and closes the review without applying
- **THEN** no transaction in the budget has changed

### Requirement: Applying itemizes the transaction
Applying a match SHALL turn the transaction into a split with one line per item. Each line's note SHALL be the item name and quantity. The lines SHALL add up exactly to the transaction amount: tax, shipping and discounts are shared out in proportion to item prices, and any rounding remainder goes to the largest line.

#### Scenario: Apply a two-item charge
- **GIVEN** a −$32.40 transaction matched to a charge of a $20.00 lamp and a $10.00 bulb pack ×2, with $2.40 tax
- **WHEN** the user applies the match
- **THEN** the transaction is a split with "Lamp ×1" −$21.60 and "Bulb pack ×2" −$10.80

#### Scenario: Rounding
- **GIVEN** a −$10.00 transaction matched to three $3.33 items with $0.01 tax
- **WHEN** the user applies the match
- **THEN** the three lines add up to exactly −$10.00

### Requirement: Parent keeps its bank fields
Applying SHALL leave the transaction's account, date, amount, payee, imported id, cleared and reconciled state unchanged. It SHALL add a link to the Amazon order and an order marker to the parent's notes, keeping any existing note text.

#### Scenario: Existing note kept
- **GIVEN** a matched transaction whose note is "birthday"
- **WHEN** the user applies the match for order 111-0000001
- **THEN** the note keeps "birthday" and adds the order link and the marker for 111-0000001, and the amount, date, payee and cleared state are unchanged

### Requirement: Applying is undoable
Applying one match or all selected matches SHALL be one undoable step that restores every changed transaction.

#### Scenario: Undo apply-all
- **WHEN** the user applies five matches at once and then undoes
- **THEN** all five transactions are back to how they were before

### Requirement: Rules can categorize items
Applying SHALL run the budget's transaction rules on each new split line and keep only the category they set, so a rule matching a line's note can categorize it. The rules SHALL NOT change any other field of the line or the parent. Lines that no rule categorizes SHALL stay uncategorized.

#### Scenario: Rule sets the category from the note
- **GIVEN** a rule "if notes contain 'Bulb' then category is Household"
- **WHEN** the user applies a match with a "Bulb pack ×2" line
- **THEN** that line's category is Household

### Requirement: Already itemized charges are skipped
A transaction whose notes carry the marker for an order SHALL NOT be offered again for that order's charges. Importing the same export twice SHALL show those charges as "Already itemized" and SHALL NOT apply them again.

#### Scenario: Import the same export twice
- **GIVEN** the user applied every match from an export
- **WHEN** the user imports the same export again
- **THEN** each of those charges shows "Already itemized", and nothing can be applied twice

### Requirement: Itemization survives bank re-sync
When bank sync or a file import later updates an itemized transaction, its split lines, their notes and the parent's order link SHALL be kept.

#### Scenario: Bank sync updates the date
- **GIVEN** an itemized transaction
- **WHEN** bank sync updates its date and cleared state
- **THEN** the split lines and notes are unchanged and the lines take the new date and cleared state
