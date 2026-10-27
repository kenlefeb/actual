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
