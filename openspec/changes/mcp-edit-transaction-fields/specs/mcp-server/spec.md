## ADDED Requirements

### Requirement: Transaction amount, date, account and cleared edits
`write_update_transactions` SHALL also set a transaction's `amount` (integer cents), `date`, `account_id` and `cleared`, with the `transactions:write` scope, the existing bounds on amounts and dates, and the same result as the same edit in the app.

#### Scenario: Correcting an opening balance
- **GIVEN** a starting-balance transaction of 205.62 in "Shared USAA Savings"
- **WHEN** a client calls `write_update_transactions` with its id and `amount` 55562
- **THEN** the transaction is 555.62, the account balance rises by 350.00, and the result shows amount 20562 before and 55562 after

#### Scenario: Moving a transaction to another account
- **WHEN** a client sets a transaction's `account_id` to another open account's id
- **THEN** the transaction is in that account with its amount, date, payee and notes unchanged, and it is no longer reconciled

#### Scenario: Moving to an off-budget account clears the category
- **GIVEN** a categorized transaction in an on-budget account
- **WHEN** a client sets its `account_id` to an off-budget account
- **THEN** the transaction has no category, and the result shows the category before and none after

#### Scenario: A closed account is refused
- **WHEN** a client sets a transaction's `account_id` to a closed account
- **THEN** the call fails with fixed text and nothing changed

#### Scenario: Marking cleared
- **WHEN** a client sets `cleared` true on an uncleared transaction
- **THEN** the transaction is cleared

### Requirement: Split edits keep the split balanced
A call SHALL be refused, before any audit line and with fixed text naming the split parent's id and the difference in cents, when after all its changes any split it touches has children that do not add up to the parent's amount. `date`, `account_id` and `cleared` SHALL be refused on a split child; set on the parent, they apply to its children.

#### Scenario: Paycheck split corrected in one call
- **GIVEN** a deposit split with parent 2,000.00 and children 1,500.00 and 500.00
- **WHEN** a client calls `write_update_transactions` with the parent's amount 210000 and the first child's amount 160000
- **THEN** the parent is 2,100.00, the children are 1,600.00 and 500.00, and the split is balanced

#### Scenario: A parent amount alone is refused
- **GIVEN** that split
- **WHEN** a client sets only the parent's amount to 210000
- **THEN** the call fails with text naming the parent and a difference of 10000, and nothing changed

#### Scenario: A date on a child is refused
- **WHEN** a client sets the `date` of a split child
- **THEN** the call fails with text saying to set it on the split parent, and nothing changed

#### Scenario: A parent's date moves its children
- **WHEN** a client sets the `date` of a split parent to 2026-11-14
- **THEN** the parent and every child are dated 2026-11-14

### Requirement: Transfer edits keep the pair
Changing a transfer side's amount or date SHALL change the other side to the opposite amount and the same date, as the app does, and the result SHALL include the other side's before and after values. Setting a transfer side's `account_id` to the other side's account SHALL be refused.

#### Scenario: Transfer amount
- **GIVEN** a transfer of -50.00 from "Checking" to "Savings"
- **WHEN** a client sets the Checking side's `amount` to -7500
- **THEN** the Savings side is 75.00, and the result lists both sides' amounts before and after

#### Scenario: A transfer to its own account
- **GIVEN** that transfer
- **WHEN** a client sets the Checking side's `account_id` to Savings
- **THEN** the call fails with fixed text and nothing changed

### Requirement: Reconciled rows need an explicit override
A change to `amount`, `date`, `account_id` or `payee_id` on a reconciled transaction, or on a transfer whose other side is reconciled, and setting `cleared` false on a reconciled transaction, SHALL be refused unless that row sets `allow_reconciled` true. With it, the change SHALL be made as after the app's confirmation: a new account or `cleared` false leaves the row not reconciled.

#### Scenario: Refused without the override
- **GIVEN** a reconciled transaction
- **WHEN** a client sets its `amount` without `allow_reconciled`
- **THEN** the call fails with text naming the row as reconciled, and nothing changed

#### Scenario: Allowed with the override
- **WHEN** a client sets the same row's `amount` with `allow_reconciled` true
- **THEN** the amount changes, and the audit line records `allow_reconciled`

#### Scenario: Unlocking a reconciled row
- **WHEN** a client sets `cleared` false on a reconciled row with `allow_reconciled` true
- **THEN** the row is neither cleared nor reconciled

#### Scenario: Category and notes need no override
- **WHEN** a client sets the `category_id` or `notes` of a reconciled row
- **THEN** the change is made without `allow_reconciled`

### Requirement: Schedule-linked rows keep their link
Editing a schedule-linked transaction's amount, date, account or cleared flag SHALL keep its schedule link and SHALL NOT change the schedule or a paycheck definition.

#### Scenario: Editing a paycheck deposit
- **GIVEN** a deposit linked to a paycheck's schedule
- **WHEN** a client sets its `amount`
- **THEN** the deposit keeps its schedule link, and the schedule and the paycheck definition are unchanged

### Requirement: Moved history is checked after the edit
The moved-history rule SHALL apply to each row as it will be after the call. A call that leaves a categorized transaction dated before its account's budget start date, or moves one into such an account before that date, SHALL be refused whole.

#### Scenario: Dating a categorized row into moved history
- **GIVEN** an account moved on budget at 2026-10-01 and a categorized transaction dated 2026-10-05
- **WHEN** a client sets its `date` to 2026-09-20
- **THEN** the call fails with text saying to do it in the app, and nothing changed

### Requirement: Cascaded changes are audited
The attempt line SHALL list every field the call will change, including the other side of a transfer and a category cleared by an off-budget move, and the result SHALL read back every affected row. The row cap SHALL count the rows the call names, not the rows that follow.

#### Scenario: The transfer partner is in the audit line
- **WHEN** a client sets a transfer side's `amount`
- **THEN** the attempt line lists the amount change for both sides

## RENAMED Requirements

- FROM: `### Requirement: Multi-row updates stop at the first failure`
- TO: `### Requirement: Multi-row updates are all or nothing`

## MODIFIED Requirements

### Requirement: Write tools
The server SHALL offer the write tools `write_create_transactions`, `write_update_transactions` (category, payee, notes, amount, date, account and cleared), `write_set_budget_amount`, `write_skip_paycheck`, `write_move_on_budget` and the category maintenance tools of "Category maintenance tools", and any write tool added later, each with its declared scopes. A tool SHALL NOT be left out or hidden to limit what an agent may do; that limit is the grant.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** every deleting tool is annotated destructive and needs the `delete` scope

### Requirement: Multi-row updates are all or nothing
`write_update_transactions` SHALL apply all its rows in one engine batch: either every row changes or none does. When the engine rejects the batch, the result and the outcome line SHALL say that nothing was applied.

#### Scenario: A failure partway
- **GIVEN** an update of 3 transactions where the engine rejects the second
- **WHEN** a client calls `write_update_transactions`
- **THEN** none of the 3 transactions changed, and the result and the outcome line list no row as applied
