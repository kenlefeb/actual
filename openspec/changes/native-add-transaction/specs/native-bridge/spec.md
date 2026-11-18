## ADDED Requirements

### Requirement: The transaction form is one read
`native/transaction-form` SHALL return, in one message, the budget's currency fields, the open accounts, the non-hidden category groups, the defaults for a new transaction, and for an id the whole transaction (parent, children, transfer partners' accounts, reconciled flags, schedule, attachment names) with a digest over every row a save could touch. An unknown id or a closed account's transaction SHALL fail.

#### Scenario: Reading a split transfer
- **GIVEN** a split whose second child is a transfer to Savings
- **WHEN** native code calls `native/transaction-form` with its id
- **THEN** the result holds the parent, both children with names resolved, Savings as the child's transfer account, and a digest

#### Scenario: The shape changes
- **GIVEN** the contract fixture checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

#### Scenario: A deleted id
- **WHEN** native code reads the form for a deleted transaction's id
- **THEN** the call fails and returns no transaction

### Requirement: Payee search is capped by a setting
`native/payees` SHALL return payees matching the search, favourites first then by name, excluding transfer payees. The search SHALL be at most 100 characters and match `%`, `_` and `\` literally. Results SHALL be capped by the synced preference `payee-picker-max-results`, default 50, ceiling 500; a value that is not a whole number from 1 to the ceiling SHALL use the default.

#### Scenario: Default cap
- **GIVEN** 5,000 payees whose names contain "a" and the preference unset
- **WHEN** native code searches "a"
- **THEN** 50 payees are returned

#### Scenario: Changed cap
- **GIVEN** `payee-picker-max-results` is 120
- **THEN** the same search returns 120 payees

#### Scenario: Bad values
- **WHEN** the preference is 0, 900, `1e2` or `abc`
- **THEN** the same search returns 50 payees

#### Scenario: Literal wildcard
- **GIVEN** payees "50% off" and "500 Club"
- **WHEN** native code searches "50%"
- **THEN** only "50% off" is returned

### Requirement: The preview applies rules and evaluates amounts in the engine
`native/transaction-preview` SHALL return the draft as the web form would show it after a field commit (rules applied only to a draft without an id, never to a field listed as cleared), every amount evaluated from its text in the budget's number format as integer minor units with its sign, the split remainder, and field errors from a closed set of codes. It SHALL write nothing.

#### Scenario: Arithmetic
- **WHEN** a draft carries amount text `12.50+3*2` with Outflow in a `1,000.33` budget
- **THEN** the preview returns an amount of −1850

#### Scenario: Rules on a new draft
- **GIVEN** a rule "payee is Costco → category Groceries"
- **WHEN** a draft without an id changes payee to Costco
- **THEN** the preview returns category Groceries and nothing is stored

#### Scenario: Field errors
- **WHEN** a draft's amount text is `12..5` and its account is closed
- **THEN** errors carry `amount-invalid` for the amount and `account-closed` for the account, codes listed in the shared fixture

### Requirement: The save is one checked, undoable write
`native/transaction-save` SHALL compute every row it touches (parent, children added or removed, transfer partners old and new) before writing, then refuse with no write: no undo token; for an edit, a digest that no longer matches (`[native:changed-since]`); an invalid draft (`[native:invalid-draft]`); a reconciled touched row without `confirmedReconciled === true` (`[native:needs-confirmed-reconciled]`).

#### Scenario: Changed since read
- **GIVEN** the form was read with digest D, then a sync changed a child's notes
- **WHEN** native code saves with digest D
- **THEN** the call fails with `[native:changed-since]` and nothing changes

#### Scenario: Reconciled partner
- **GIVEN** an edit whose transfer partner is reconciled
- **WHEN** native code saves with `confirmedReconciled` false, `"true"` or 1
- **THEN** the call fails with `[native:needs-confirmed-reconciled]` and nothing changes

#### Scenario: Invalid draft
- **WHEN** the children do not sum to the parent
- **THEN** the call fails with `[native:invalid-draft]` and nothing changes

### Requirement: A save stores the web form's result as one undo step
A save that passes its checks SHALL run the rules again for a new transaction, create a new payee named in the draft, write with the synced `learn-categories` preference, and be one undo step that `native/undo` reverses only while no touched row has changed since. A repeated save with an undo token that already landed SHALL return the same id and write nothing.

#### Scenario: Undo
- **WHEN** native code saves a new split with a new payee and then calls `native/undo` with its token
- **THEN** the transaction, its children and the new payee are gone

#### Scenario: Undo after a later change
- **GIVEN** a save, then a sync changes the saved row's amount
- **WHEN** native code calls `native/undo` with the save's token
- **THEN** the call fails with `[native:undo-changed-since]` and nothing changes

#### Scenario: Repeated token
- **WHEN** native code sends the same save twice with the same undo token
- **THEN** both calls return the same id and one transaction exists

### Requirement: Split size is a setting
A save or preview SHALL refuse more children than the synced preference `transaction-split-max-children`, default 50, ceiling 200; a value that is not a whole number from 1 to the ceiling SHALL use the default. Over the limit, the preview SHALL report `split-limit` and the save SHALL refuse with `[native:invalid-draft]`.

#### Scenario: Over the default
- **GIVEN** the preference unset
- **WHEN** native code saves a split with 51 children
- **THEN** the call fails with `[native:invalid-draft]` and nothing is stored

#### Scenario: Raised limit
- **GIVEN** `transaction-split-max-children` is 120
- **THEN** a split with 100 children saves

### Requirement: The transaction handlers are allowlisted with listed fields
The bridge SHALL allowlist `native/transaction-form`, `native/payees`, `native/transaction-preview` and `native/transaction-save` in both the page list and the Swift list, which SHALL be equal. The page SHALL forward only each name's listed fields. `transactions-batch-update`, `transaction-add`, `rules-run` and `payee-create` SHALL stay refused for native callers.

#### Scenario: An extra field
- **WHEN** native code sends `native/transaction-save` with an extra field `learnCategories: false`
- **THEN** the page drops that field and the save reads `learn-categories` from the budget's preference

#### Scenario: A raw handler
- **WHEN** native code calls `transactions-batch-update`
- **THEN** the bridge refuses it and nothing is written

### Requirement: Form reads and previews meet the latency gate
On a seed of 5,000 payees, 40 accounts, 150 categories, 300 rules and a 50-child split, the median loot-core time SHALL be under 50 ms for: a two-letter and an empty payee search, a payee-change preview on a new transaction, an amount-change preview on the split, and the form read of the split.

#### Scenario: The perf suite
- **WHEN** the native perf suite runs in Fork CI
- **THEN** each of the five measurements prints its median and p95, and the job fails if any median is 50 ms or more
