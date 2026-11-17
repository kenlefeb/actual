## ADDED Requirements

### Requirement: Reconcile an account
`write_reconcile_account` (`transactions:write`) SHALL take an account id and a statement balance in integer cents, compute the cleared balance and the difference as the app does, and only when the difference is zero set `reconciled` on the account's cleared, unreconciled rows and stamp its `last_reconciled`. It SHALL never create an adjustment row.

#### Scenario: A zero difference locks the cleared rows
- **GIVEN** an account whose cleared rows total 12,345 cents and 3 cleared rows are not reconciled
- **WHEN** a client reconciles it to 12,345
- **THEN** the 3 rows are reconciled, uncleared rows are untouched and `last_reconciled` is set

#### Scenario: A difference writes nothing
- **WHEN** a client reconciles that account to 12,000
- **THEN** the result gives the cleared balance and the difference of -345, no row changed and `last_reconciled` is unchanged

#### Scenario: Split children follow their parent
- **WHEN** a cleared split parent is locked
- **THEN** its children are reconciled too

### Requirement: A reconcile needs a dry run and a confirm
`write_reconcile_account` SHALL be destructive: under `confirm_destructive` its first call SHALL return the rows to lock, the cleared balance and the difference with a `confirm` bound to them, and it SHALL write only with that `confirm`, after recomputing the same plan.

#### Scenario: Dry run, then confirm
- **WHEN** a client calls it with a zero difference under `confirm_destructive`, then again with the returned `confirm`
- **THEN** the first call writes nothing and the second locks the listed rows

#### Scenario: A stale confirm
- **WHEN** a cleared row is added or changed between the two calls
- **THEN** the second call is refused and nothing changed

### Requirement: Reconciliation reads
Transaction reads SHALL return `reconciled`, and `get_account_reconciliation` (`budget:read`) SHALL return an account's cleared balance, its count of cleared unreconciled rows and its `last_reconciled`, and the difference when given a statement balance, from the query the write uses.

#### Scenario: The read matches the write
- **WHEN** a client reads an account's cleared balance and then reconciles it to that balance
- **THEN** the difference is zero and the rows locked equal the read count

### Requirement: Reconciling has its own row limit
A reconcile SHALL be refused before any audit line when the rows it would lock, split children included, exceed the connection's `max_reconcile_rows`, which SHALL default to a setting of 500, be replaced by a grant's value up to an operator ceiling of 2,000 and not be limited by `max_rows`.

#### Scenario: More rows than the limit
- **GIVEN** a limit of 500 and 501 cleared unreconciled rows
- **WHEN** a client reconciles the account to its cleared balance
- **THEN** the call is refused, naming 501 and 500, and no row changed

#### Scenario: The row limit does not apply
- **GIVEN** `max_rows` of 10 and a reconcile locking 40 rows
- **THEN** the call succeeds

#### Scenario: A grant above the ceiling
- **WHEN** a grant sets `max_reconcile_rows` above the ceiling
- **THEN** the grants file is invalid and every write tool is refused by scope

#### Scenario: The audit tail cannot hold the ceiling
- **WHEN** 4 times the ceiling times 150 bytes exceeds the audit tail
- **THEN** the server refuses to start

### Requirement: A reconcile is audited
A reconcile SHALL log one `reconciled` change (false to true) per locked row and a `last_reconciled` change on the account, with `schema: 2` and the balance and difference. It is not undoable by `write_undo`.

#### Scenario: Audit lines
- **WHEN** a client locks 2 rows
- **THEN** the attempt line holds 2 `reconciled` changes, the `last_reconciled` before and after, the balance and the difference

#### Scenario: Undo is refused
- **WHEN** a client undoes a reconcile
- **THEN** `write_undo` refuses it as not undoable and nothing changed
