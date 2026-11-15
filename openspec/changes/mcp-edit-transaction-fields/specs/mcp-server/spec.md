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
Editing a transfer side SHALL update the other side as the app does: the opposite amount, the edited side's notes and schedule, the transfer payee of the edited side's account, and no category on either side when both accounts are on budget or both off. A date change SHALL move only the named side. The result SHALL include the other side's before and after values. Moving a side into the other side's account SHALL be refused, and so SHALL a call that names both sides of one transfer.

#### Scenario: Transfer amount
- **GIVEN** a transfer of -50.00 from "Checking" to "Savings"
- **WHEN** a client sets the Checking side's `amount` to -7500
- **THEN** the Savings side is 75.00, and the result lists both sides' amounts before and after

#### Scenario: Transfer date
- **GIVEN** that transfer, both sides dated 2026-11-10
- **WHEN** a client sets the Checking side's `date` to 2026-11-14
- **THEN** the Checking side is dated 2026-11-14 and the Savings side keeps 2026-11-10

#### Scenario: Moving a transfer side to another account
- **GIVEN** that transfer and an open account "Credit Union"
- **WHEN** a client sets the Checking side's `account_id` to Credit Union
- **THEN** the Savings side's payee becomes the transfer payee for Credit Union, and the result lists that payee change

#### Scenario: Notes follow to the other side
- **WHEN** a client sets the Checking side's `notes`
- **THEN** the Savings side has the same notes, and the result lists that change

#### Scenario: A transfer to its own account
- **GIVEN** that transfer
- **WHEN** a client sets the Checking side's `account_id` to Savings
- **THEN** the call fails with fixed text and nothing changed

#### Scenario: Both sides of one transfer in one call
- **GIVEN** that transfer
- **WHEN** a client names both the Checking side and the Savings side in one call
- **THEN** the call fails with fixed text and nothing changed, because the engine would update each side from the other in no fixed order

### Requirement: Payee edits never link or unlink a transfer
A payee change that would link or unlink a transfer SHALL be refused with fixed text before any audit line: a new payee on a transfer side, or a transfer payee on an ordinary row or on a split parent whose children would take it. The engine would create or delete the other side, outside the audit line and the `delete` scope. Linking transfers is sc-4205.

#### Scenario: A payee edit that would unlink a transfer
- **GIVEN** that transfer
- **WHEN** a client sets the Checking side's `payee_id` to an ordinary payee
- **THEN** the call fails with fixed text saying to do it in the app, and the Savings side still exists

#### Scenario: A transfer payee on an ordinary row
- **WHEN** a client sets an ordinary transaction's `payee_id` to the transfer payee of another account
- **THEN** the call fails with fixed text, and no transaction is created in that account

### Requirement: Reconciled rows need an explicit override
A change to `amount`, `date`, `account_id` or `payee_id` on a reconciled transaction, or on a transfer whose other side is reconciled, and setting `cleared` false on a reconciled transaction, SHALL be refused unless that row sets `allow_reconciled` true. A split parent's edit SHALL be checked on each child it reaches, and on each child's transfer partner. With the override, the change SHALL be made as after the app's confirmation: a new account or `cleared` false leaves the row not reconciled.

#### Scenario: Refused without the override
- **GIVEN** a reconciled transaction
- **WHEN** a client sets its `amount` without `allow_reconciled`
- **THEN** the call fails with text naming the row as reconciled, and nothing changed

#### Scenario: Allowed with the override
- **GIVEN** a grant with `allow_reconciled`
- **WHEN** a client sets the same row's `amount` with `allow_reconciled` true
- **THEN** the amount changes, and the audit line records `allow_reconciled` for that row

#### Scenario: A split child's reconciled transfer partner
- **GIVEN** a split whose child is a transfer to "Savings", with the Savings side reconciled
- **WHEN** a client sets the split parent's `account_id` without `allow_reconciled`
- **THEN** the call fails with fixed text and nothing changed

#### Scenario: Unlocking a reconciled row
- **WHEN** a client sets `cleared` false on a reconciled row with `allow_reconciled` true
- **THEN** the row is neither cleared nor reconciled

#### Scenario: Category and notes need no override
- **WHEN** a client sets the `category_id` or `notes` of a reconciled row
- **THEN** the change is made without `allow_reconciled`

### Requirement: The reconciled override needs the grant
`allow_reconciled` on a row SHALL be refused unless the connection's grant has the `allow_reconciled` option, which is off when absent (Ken, 2026-11-15). The attempt line SHALL record an `allow_reconciled` entry for each reconciled row or transfer partner actually overridden, and the result SHALL name them in `reconciled_overridden`.

#### Scenario: The grant doesn't allow the override
- **GIVEN** a grant without `allow_reconciled`
- **WHEN** a client sets any row's `allow_reconciled` true
- **THEN** the call fails with fixed text and nothing changed

#### Scenario: An override recorded on the side it overrides
- **GIVEN** a grant with `allow_reconciled` and a transfer whose Savings side is reconciled
- **WHEN** a client sets the Checking side's `amount` with `allow_reconciled` true
- **THEN** the attempt line records `allow_reconciled` for the Savings side, and the result names it in `reconciled_overridden`

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
The attempt line SHALL list every field the call will change, including the other side of a transfer (amount, payee, notes, schedule, category) and a category cleared by an off-budget move, and the result SHALL read back every affected row. The row cap SHALL count both the rows the call names and every row it changes: the named rows, split children and transfer partners.

#### Scenario: The transfer partner is in the audit line
- **WHEN** a client sets a transfer side's `amount`
- **THEN** the attempt line lists the amount change for both sides

#### Scenario: A notes edit on a transfer is audited on both sides
- **WHEN** a client sets a transfer side's `notes`
- **THEN** the attempt line lists the notes change for both sides

#### Scenario: The row cap counts the rows that follow
- **GIVEN** a grant with `max_rows` 1
- **WHEN** a client sets one transfer side's `amount`
- **THEN** the call fails with the row-cap text and nothing changed, because it would change two rows

## RENAMED Requirements

- FROM: `### Requirement: Multi-row updates stop at the first failure`
- TO: `### Requirement: Multi-row updates apply together`

## MODIFIED Requirements

### Requirement: Write tools
The server SHALL offer the write tools `write_create_transactions`, `write_update_transactions` (category, payee, notes, amount, date, account and cleared), `write_set_budget_amount`, `write_skip_paycheck`, `write_move_on_budget` and the category maintenance tools of "Category maintenance tools", and any write tool added later, each with its declared scopes. A tool SHALL NOT be left out or hidden to limit what an agent may do; that limit is the grant.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** every deleting tool is annotated destructive and needs the `delete` scope

### Requirement: Multi-row updates apply together
`write_update_transactions` SHALL write its named rows' changes, split children included, in one engine batch, so all of them change or none does; transfer partners follow in a second step, as in the app. When the engine fails, the result and the outcome line SHALL report the state read back: which named rows and partners hold the new values. If that read-back fails too, they SHALL record `applied` as null and `read_back` as `failed`, never an empty list.

#### Scenario: A failure partway
- **GIVEN** an update of 3 transactions where the engine rejects the second
- **WHEN** a client calls `write_update_transactions`
- **THEN** none of the 3 transactions changed, and the result and the outcome line list no row as applied

#### Scenario: The transfer step fails
- **GIVEN** an amount change on a transfer side whose partner update fails in the transfer step
- **WHEN** a client calls `write_update_transactions`
- **THEN** the result and the outcome line list the named side as applied and the partner as not updated
