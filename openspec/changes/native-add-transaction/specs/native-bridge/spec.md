## ADDED Requirements

### Requirement: The transaction form is one read
`native/transaction-form` SHALL return, in one message, the currency fields, the open accounts with their transfer payee ids, the non-hidden category groups, the defaults for a new transaction, and for an id the whole transaction (parent, children, transfer partners' accounts and whether each is closed, reconciled flags, schedule, attachment names) with its digest. An id that is not a live top-level transaction, or is in a closed account, SHALL fail with `[native:not-found]`.

#### Scenario: Reading a split transfer
- **GIVEN** a split whose second child is a transfer to Savings
- **WHEN** native code calls `native/transaction-form` with its id
- **THEN** the result holds the parent, both children with names resolved, Savings as the child's transfer account, and a digest

#### Scenario: The shape changes
- **GIVEN** the contract fixture checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

#### Scenario: Transfer payees
- **WHEN** native code reads the form
- **THEN** each open account carries the id of its transfer payee

#### Scenario: A deleted id
- **WHEN** native code reads the form for a deleted transaction's id
- **THEN** the call fails with `[native:not-found]` and returns no transaction

### Requirement: The edit digest covers every row a save can touch
The digest SHALL be computed from the same row state the native undo check reads, over the parent, its children and every transfer partner: their sorted ids, parent link, transfer link, schedule, account, date, payee, category, amount, notes, cleared, reconciled, tombstone and order. Adding that state SHALL leave the accounts writes' undo checks passing.

#### Scenario: A child added elsewhere
- **GIVEN** the form was read with digest D, then a sync adds a child to the split
- **WHEN** the digest is computed again
- **THEN** it differs from D

#### Scenario: A relinked transfer
- **GIVEN** the form was read, then a sync changes a child's transfer link
- **THEN** the recomputed digest differs

### Requirement: Payee search returns live payees under setting limits
`native/payees` SHALL return only live, non-transfer payees as id, name and favourite, favourites first then by name, matching `%`, `_` and `\` literally. The search SHALL be at most `payee-search-max-length` characters (default 100, ceiling 200) and results at most `payee-picker-max-results` (default 50, ceiling 500); a malformed or out-of-range value SHALL use the default.

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

#### Scenario: A deleted payee
- **GIVEN** a deleted payee "Costco Old"
- **WHEN** native code searches "costco"
- **THEN** "Costco Old" is not returned

#### Scenario: Search too long
- **WHEN** native code searches 101 characters with the setting unset
- **THEN** the call fails and returns no payees

### Requirement: The draft accepts only listed keys
loot-core SHALL accept a draft and its splits only with the listed keys and types (new id or id, account, date, payee or payee name, category, notes, cleared, inflow, amount text, splits, and the person's own fields), and SHALL refuse anything else with `[native:invalid-draft]` for both the preview and the save.

#### Scenario: A smuggled key
- **WHEN** native code saves a draft carrying `reconciled: true` or `imported_id`
- **THEN** the call fails with `[native:invalid-draft]` and nothing is stored

#### Scenario: A wrong type
- **WHEN** a draft's `cleared` is `"yes"`
- **THEN** the preview fails with `[native:invalid-draft]`

### Requirement: The preview evaluates amounts and rules without writing
`native/transaction-preview` SHALL return the draft as the web form would show it after a field commit, each amount evaluated from its text in the budget's number format as signed integer minor units, the split remainder, the fields set by rules, any fields a payee change replaced with their previous values, and field errors from a closed set of codes. It SHALL write nothing and never create a payee.

#### Scenario: Arithmetic
- **WHEN** a draft carries amount text `12.50+3*2` with Outflow in a `1,000.33` budget
- **THEN** the preview returns an amount of −1850

#### Scenario: Rules on a new draft
- **GIVEN** a rule "payee is Costco → category Groceries"
- **WHEN** a draft without an id changes payee to Costco
- **THEN** the preview returns category Groceries, lists category as set by a rule, and nothing is stored

#### Scenario: A new payee name
- **WHEN** a draft names the new payee "Corner Bakery"
- **THEN** no payee is created

### Requirement: Rules keep the person's own fields
In a preview of a new draft, rules SHALL not change a field the person set or cleared by hand, except that a payee change may replace it, as on the web; each field so replaced SHALL be returned with its previous value. A draft with an id SHALL run no rules.

#### Scenario: A cleared category
- **GIVEN** the Costco rule filled Groceries, then the person cleared the category
- **WHEN** the amount changes
- **THEN** the category stays empty

#### Scenario: Replaced by a payee change
- **GIVEN** the person chose category Dining by hand
- **WHEN** the payee changes to Costco
- **THEN** the preview returns Groceries and lists category as replaced, previously Dining

### Requirement: Field values are bounded
The engine SHALL report as field errors: amount text over 100 characters, or an amount not finite, not whole minor units or beyond the safe integer range (`amount-invalid`); notes on any row over `transaction-notes-max-length` (default 10,000, ceiling 50,000; `notes-too-long`); a date that is not real or outside 1900-01-01 to 2999-12-31 (`date-invalid`). A future date SHALL be allowed.

#### Scenario: Huge amount
- **WHEN** amount text evaluates to 1e20
- **THEN** the preview reports `amount-invalid`

#### Scenario: Child notes
- **WHEN** a split child's notes are 10,001 characters with the setting unset
- **THEN** the preview reports `notes-too-long` on that child

#### Scenario: Dates
- **WHEN** the date is 2026-02-30 or 1899-12-31
- **THEN** the preview reports `date-invalid`, and 2027-01-15 is accepted

### Requirement: Transfers need open accounts
The preview and the save SHALL report `account-closed` when the transaction's account, or the account of any transfer payee in the draft, is closed or deleted.

#### Scenario: Transfer to a closed account
- **GIVEN** Savings is closed
- **WHEN** a draft picks Savings's transfer payee
- **THEN** the preview reports `account-closed` and the save fails with `[native:invalid-draft:account-closed]`

### Requirement: The save checks before it writes
`native/transaction-save` SHALL refuse, writing nothing: a draft of the wrong shape or with no undo token (`[native:invalid-draft]`); an edit with no digest or a digest that no longer matches (`[native:changed-since]`); an invalid draft (`[native:invalid-draft:<codes>]`, listing only field codes from the fixture, never user text); a reconciled touched row without `confirmedReconciled === true` (`[native:needs-confirmed-reconciled]`).

#### Scenario: Changed since read
- **GIVEN** the form was read with digest D, then a sync changed a child's notes
- **WHEN** native code saves with digest D
- **THEN** the call fails with `[native:changed-since]` and nothing changes

#### Scenario: No digest
- **WHEN** native code saves an edit without a digest
- **THEN** the call fails with `[native:changed-since]`

#### Scenario: Refusal carries codes only
- **WHEN** a save fails validation for notes the person typed
- **THEN** the message is `[native:invalid-draft:notes-too-long]` and holds none of the notes

#### Scenario: No undo token
- **WHEN** native code saves without `undoToken`
- **THEN** the call fails with `[native:invalid-draft]`

### Requirement: Rules run first at save and must match the preview
For a new transaction the save SHALL run the rules first, keeping the person's own fields. If the result differs from the submitted draft in any field, the save SHALL refuse with `[native:preview-stale]`. The touched set, validation and reconciled check SHALL apply to that result, so a save stores exactly the draft the person last saw.

#### Scenario: A rule changed after the preview
- **GIVEN** a preview showed category Groceries, then a sync edited the rule to set Household
- **WHEN** native code saves the previewed draft
- **THEN** the call fails with `[native:preview-stale]` and nothing is stored

#### Scenario: A rule sets a closed account
- **GIVEN** a rule sets the account to a closed account
- **WHEN** a new draft is saved
- **THEN** the save writes nothing and refuses

### Requirement: A reconciled split parent counts for its children
A save and `native/transactions-delete` SHALL treat a touched row as reconciled when it, or the split parent of a touched child, is reconciled, and SHALL require `confirmedReconciled === true` for it.

#### Scenario: Partner in a reconciled split
- **GIVEN** a transfer whose partner is a child of a reconciled split, the child's own flag unset
- **WHEN** native code deletes the transfer without `confirmedReconciled`
- **THEN** the call fails with `[native:needs-confirmed-reconciled]` and nothing changes

### Requirement: A repeated add never stores twice
An add SHALL carry a new id chosen by native code: a lowercase UUID (8-4-4-4-12 hex), or the save SHALL refuse with `[native:invalid-draft]`. A repeat SHALL match only a live top-level row in the draft's account with the same date, amount, payee, category and child count: it returns that id and writes nothing. Any other row with that id SHALL refuse, `[native:changed-since]` if deleted, else `[native:invalid-draft]`. This SHALL hold across restarts.

#### Scenario: Retry after an engine restart
- **GIVEN** a save of new id N landed, then the engine restarted before its answer arrived
- **WHEN** native code saves the same draft with N again
- **THEN** it returns N and one transaction exists

#### Scenario: Retry after undo
- **GIVEN** a save of N landed and was undone
- **WHEN** native code saves the same draft with N again
- **THEN** the call fails with `[native:changed-since]` and no transaction exists

#### Scenario: Same id, different draft
- **WHEN** native code saves N again with a different amount
- **THEN** the call fails with `[native:invalid-draft]` and the first transaction is unchanged

#### Scenario: A malformed id
- **WHEN** native code saves a new draft whose id is `ABC`, `../x`, an upper-case UUID or 500 characters long
- **THEN** the call fails with `[native:invalid-draft]` and nothing is stored

#### Scenario: The id of a split child or another account's row
- **GIVEN** id N belongs to a split child, or to a live row in another account
- **WHEN** native code saves a new draft with N
- **THEN** the call fails with `[native:invalid-draft]`, returns no id, and nothing changes

### Requirement: A save stores the web form's result as one undo step
A save that passes its checks SHALL create a new payee only from a trimmed, non-empty name within `payee-name-max-length` (default 200, ceiling 500), reuse a live payee whose name matches ignoring case, refuse a name equal to a transfer payee, write with the synced `learn-categories` preference, and be one undo step that `native/undo` reverses only while no touched row has changed.

#### Scenario: Undo
- **WHEN** native code saves a new split with a new payee and then calls `native/undo` with its token
- **THEN** the transaction, its children and the new payee are gone

#### Scenario: Undo after a later change
- **GIVEN** a save, then a sync changes the saved row's amount
- **WHEN** native code calls `native/undo` with the save's token
- **THEN** the call fails with `[native:undo-changed-since]` and nothing changes

#### Scenario: Existing payee, other case
- **GIVEN** a payee "Costco"
- **WHEN** a draft names the new payee "costco "
- **THEN** the save uses "Costco" and creates no payee

#### Scenario: Transfer payee name
- **WHEN** a draft names the new payee equal to the transfer payee of Savings
- **THEN** the call fails with `[native:invalid-draft]` and no payee is created

### Requirement: Split size is a setting
A save or preview SHALL refuse more children than `transaction-split-max-children`, default 50, ceiling 200; a malformed or out-of-range value SHALL use the default. Over the limit, the preview SHALL report `split-limit` and the save SHALL refuse with `[native:invalid-draft:split-limit]`.

#### Scenario: Over the default
- **GIVEN** the preference unset
- **WHEN** native code saves a split with 51 children
- **THEN** the call fails with `[native:invalid-draft:split-limit]` and nothing is stored

#### Scenario: Raised limit
- **GIVEN** `transaction-split-max-children` is 120
- **THEN** a split with 100 children saves

### Requirement: Refusal and field codes are shared fixtures
`changed-since`, `preview-stale` and `not-found` SHALL be listed in the shared native refusal codes fixture. Field error codes SHALL be listed in their own fixture, and the two SHALL share no code. Both sides SHALL test against both fixtures.

#### Scenario: A new code
- **WHEN** loot-core refuses with a code not in the refusal fixture
- **THEN** the fixture test fails

#### Scenario: Overlap
- **WHEN** a code appears in both fixtures
- **THEN** the fixture test fails

### Requirement: The transaction handlers are allowlisted with listed fields
The bridge SHALL allowlist `native/transaction-form`, `native/payees`, `native/transaction-preview` and `native/transaction-save` in both the page list and the Swift list, which SHALL be equal. The page SHALL forward only each name's listed fields. `transactions-batch-update`, `transaction-add`, `rules-run` and `payee-create` SHALL stay refused for native callers.

#### Scenario: An extra field
- **WHEN** native code sends `native/transaction-save` with an extra field `learnCategories: false`
- **THEN** the page drops that field and the save reads `learn-categories` from the budget's preference

#### Scenario: A raw handler
- **WHEN** native code calls `transactions-batch-update`
- **THEN** the bridge refuses it and nothing is written

### Requirement: The transaction hand-off is checked on both sides
Swift SHALL send `webTransactionAction` only with a saved, live id from the form read. The page SHALL accept only the actions `make-recurring` and `documents`, an id of letters, digits, `_` and `-` that is a live transaction, and SHALL encode the id in the path. Anything else SHALL be ignored.

#### Scenario: A path in the id
- **WHEN** the page receives `webTransactionAction` with id `../settings`
- **THEN** it ignores the message and nothing opens

#### Scenario: Unknown action
- **WHEN** the page receives action `delete`
- **THEN** it ignores the message

### Requirement: Form reads, previews and saves meet the latency gate
On a seed of 5,000 payees, 40 accounts, 150 categories, 300 rules and a 50-child split, the median loot-core time SHALL be under 50 ms for: a two-letter and an empty payee search, a payee-change preview on a new transaction, an amount-change preview on the split, the form read of the split, and a new transaction's save.

#### Scenario: The perf suite
- **WHEN** the native perf suite runs in Fork CI
- **THEN** each of the six measurements prints its median and p95, and the job fails if any median is 50 ms or more
