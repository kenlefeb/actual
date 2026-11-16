# api-transaction-mutations Specification

## Purpose
Defines how the public API's transaction update and delete calls complete, report failure and treat partial updates, so automated clients can rely on their writes.

## Requirements

### Requirement: Mutations complete before returning
The API's transaction update and delete calls SHALL resolve only after the underlying write has finished, returning the affected transactions.

#### Scenario: Immediate read after update
- **WHEN** a client updates a transaction and immediately reads the account's transactions
- **THEN** the read reflects the update

#### Scenario: Immediate read after delete
- **WHEN** a client deletes a transaction and immediately reads the account's transactions and balance
- **THEN** the deleted transaction is absent and the balance excludes it

#### Scenario: Budget closed right after a mutation
- **WHEN** a client updates or deletes a transaction, then shuts down and reloads the budget
- **THEN** the reloaded budget contains the completed change

### Requirement: Mutation failures reach the caller
The API's transaction update and delete calls SHALL reject with the underlying error when the write fails.

#### Scenario: Write failure on update or delete
- **WHEN** the write behind a transaction update or delete fails
- **THEN** the API call rejects with that failure instead of resolving

### Requirement: Partial updates preserve unmentioned fields
Updating a transaction with a subset of fields SHALL change only those fields. For a split child, its other fields, its parent and its sibling splits SHALL remain unchanged.

#### Scenario: Update one field of a split child
- **WHEN** a client updates only the notes of one split child
- **THEN** that child has the new notes and keeps its amount and category
- **AND** the parent and every sibling split are unchanged
- **AND** the account balance is unchanged

#### Scenario: Partial update survives reload
- **WHEN** the budget is reloaded after a partial split update
- **THEN** the split transactions match their state immediately after the update

### Requirement: Several transactions update as one batch
The API's `updateTransactions` SHALL take a list of transaction ids with partial fields, apply them in order to the transactions and their splits as the app's own edit does, and write the named transactions' changes, split children included, in one batch, so either all of them are made or none is. Transfer partners SHALL follow in a second step, as for a single update. It SHALL resolve with the updated transactions.

#### Scenario: A split's parent and children together
- **GIVEN** a split of -100.00 with children -60.00 and -40.00
- **WHEN** a script calls `updateTransactions` with the parent's amount -120.00 and the first child's amount -80.00
- **THEN** the parent is -120.00, the children are -80.00 and -40.00, and the split shows no error

#### Scenario: One update fails
- **GIVEN** two updates where the second names a transaction that does not exist
- **WHEN** a script calls `updateTransactions`
- **THEN** the call rejects and the first transaction is unchanged

#### Scenario: A transfer follows
- **GIVEN** a transfer of -50.00 from "Checking" to "Savings", both dated 2026-11-10
- **WHEN** a script calls `updateTransactions` to set the Checking side's amount to -75.00 and its date to 2026-11-14
- **THEN** the Savings side is 75.00 and keeps its date 2026-11-10, as in the app

#### Scenario: The transfer step fails
- **GIVEN** a transfer side whose partner update throws in the transfer step
- **WHEN** a script calls `updateTransactions` to change that side's amount
- **THEN** the call rejects, the named side has its new amount and the partner keeps its old one
