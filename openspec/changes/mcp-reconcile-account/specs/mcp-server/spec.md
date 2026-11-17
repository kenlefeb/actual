## ADDED Requirements

### Requirement: Reconciling has its own scope
Locking rows SHALL need the scope `transactions:reconcile`, which no other scope implies and `transactions:write` does not grant. The stdio writes entry grants it when `ACTUAL_MCP_WRITES_SCOPES` is unset; a hosted grant holds it only when listed, and never on a `*` client.

#### Scenario: A writer cannot reconcile
- **GIVEN** a grant of `budget:read transactions:write`
- **WHEN** a client calls `write_reconcile_account`
- **THEN** the call is refused by scope and nothing changed

#### Scenario: A wildcard client
- **WHEN** the client `*` grant lists `transactions:reconcile`
- **THEN** the grants file is invalid and every write tool is refused by scope

### Requirement: Reconcile an account
`write_reconcile_account` (`transactions:reconcile`) SHALL take an account id and a statement balance in integer cents, compute the cleared balance and difference as the app does, and only when the difference is zero lock the account's cleared, unreconciled rows and stamp `last_reconciled`. It SHALL never create an adjustment row.

#### Scenario: A zero difference locks the cleared rows
- **GIVEN** cleared rows totalling 12,345 cents, 3 of them unreconciled
- **WHEN** a client reconciles the account to 12,345 and confirms
- **THEN** the 3 rows are reconciled, uncleared rows are untouched and `last_reconciled` is set

#### Scenario: A difference writes nothing
- **WHEN** a client reconciles that account to 12,000
- **THEN** the result gives the cleared balance and the difference of -345, no confirm is issued, no row changed and `last_reconciled` is unchanged

#### Scenario: Zero rows to lock
- **GIVEN** every cleared row is already reconciled and the difference is zero
- **WHEN** a client reconciles and confirms
- **THEN** no row changes, `last_reconciled` is stamped and the audit line records that change

### Requirement: A reconcile is always two steps
`write_reconcile_account` SHALL answer its first call with a dry run, whatever `confirm_destructive` says, and lock only on a second call with the returned `confirm`, which SHALL be bound by digest to each row's id, amount, date, account, cleared flag and parent, to its transfer partners and to the balance. The dry run SHALL state in fixed text that MCP cannot undo or unlock the rows.

#### Scenario: The dry run discloses the lock
- **WHEN** a client calls it on an account with a zero difference
- **THEN** nothing changed and the dry run lists the row ids and says rows locked can be unlocked only in the app, or by `allow_reconciled` once released, and not by `write_undo`

#### Scenario: Two rows swap amounts
- **WHEN** after the dry run row A changes from 100 to 90 and row B from 50 to 60
- **THEN** the confirm is refused and nothing changed

#### Scenario: Grants without confirm_destructive
- **GIVEN** a grant with `confirm_destructive` off
- **WHEN** a client calls it without a confirm
- **THEN** it still returns a dry run and locks nothing

### Requirement: A reconcile is atomic and verified
The lock SHALL run inside the write lock, recompute the plan and require it to equal the confirmed one, apply all rows in one batch, then re-read the cleared balance. When it no longer equals the statement balance the result and outcome line SHALL say `verified: false` with the new balance, list the rows locked and not stamp `last_reconciled`.

#### Scenario: A sync lands during the write
- **WHEN** a cleared row arrives between the recompute and the re-read
- **THEN** the locked rows are reported, `verified` is false, `last_reconciled` is not stamped and the audit outcome names the new difference

### Requirement: A reconcile selects whole splits
A reconcile SHALL select only rows that are not split children, sum those rows for the cleared balance, and lock each selected split parent together with all its children. A child whose parent is not selected SHALL stay as it is and be named in the result.

#### Scenario: A split parent
- **WHEN** a cleared parent with 2 children is locked
- **THEN** the children are reconciled and the balance counted the parent once

#### Scenario: A reconciled parent with an unreconciled child
- **WHEN** the parent is already reconciled and a child is not
- **THEN** the child is not locked and the result names it as skipped

### Requirement: A reconcile names the transfer partners it freezes
The dry run SHALL list the ids of the other legs of every transfer it locks, so the freeze is visible; locking changes no partner row.

#### Scenario: A transfer leg
- **WHEN** a client reconciles Checking, which holds a transfer leg to Savings
- **THEN** the dry run lists the Savings leg's id, and the Savings row is unchanged after the lock

### Requirement: Reconciliation reads
Transaction reads SHALL return `reconciled`, and `get_account_reconciliation` (`budget:read`) SHALL return an account's cleared balance, its count of cleared unreconciled rows and its `last_reconciled`, from the query the write uses. Its result is not proof of a statement balance.

#### Scenario: The read matches the write
- **WHEN** a client reads an account's cleared balance and reconciles to it
- **THEN** the difference is zero and the rows locked equal the read count

### Requirement: Reconciling has its own row limit
A reconcile SHALL be refused before any audit line when the rows it would lock, split children included, exceed the connection's `max_reconcile_rows`: a setting defaulting to 500, replaceable by a grant's value up to an operator ceiling of 1,000, and not limited by `max_rows`.

#### Scenario: More rows than the limit
- **GIVEN** a limit of 500 and 501 rows to lock
- **WHEN** a client reconciles to the cleared balance
- **THEN** the call is refused, naming 501 and 500, and no row changed

#### Scenario: The row limit does not apply
- **GIVEN** `max_rows` of 10 and 40 rows to lock
- **THEN** the call succeeds

#### Scenario: A grant above the ceiling
- **WHEN** a grant's `max_reconcile_rows` is above the ceiling or not a positive integer
- **THEN** the grants file is invalid and every write tool is refused by scope

### Requirement: The reconcile limit fits the audit tail and the response
The server SHALL refuse to start when 4 writes of the reconcile ceiling do not fit the audit tail, a check separate from and no larger than the strictest of the row, cell and delete checks. A dry run that exceeds `MAX_RESPONSE_BYTES` SHALL be refused with no confirm.

#### Scenario: The tail cannot hold the ceiling
- **WHEN** 4 times the ceiling times the per-row bytes exceeds the audit tail
- **THEN** the server refuses to start

#### Scenario: A ceiling-size dry run fits
- **GIVEN** the default response size and 1,000 rows each with one transfer partner
- **THEN** the dry run is returned whole

### Requirement: A reconcile is audited
A reconcile SHALL log, with `schema: 2`, the row ids to lock, one change for the account's `last_reconciled` before and after, the statement balance, cleared balance and difference, and the plan digest, even when no row locks. It is not undoable by `write_undo`.

#### Scenario: Audit lines
- **WHEN** a client locks 2 rows
- **THEN** the attempt line holds the 2 ids, the `last_reconciled` change, the balances and the digest, and the outcome line lists the applied ids and `verified`

#### Scenario: Undo is refused
- **WHEN** a client undoes a reconcile
- **THEN** `write_undo` refuses it as not undoable and nothing changed
