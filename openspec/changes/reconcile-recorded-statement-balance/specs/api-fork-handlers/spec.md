## ADDED Requirements

### Requirement: Typed methods for the statement balance record
`@actual-app/api` SHALL export `getAccountStatementBalance` and `consumeAccountStatementBalance`, each calling its handler with the arguments unchanged and returning its result with the same errors, and SHALL export no method that saves a record. The listed handlers in the API test grow by these two.

#### Scenario: A script reads and consumes
- **GIVEN** an account with an unconsumed record
- **WHEN** a script calls `getAccountStatementBalance` then `consumeAccountStatementBalance` with its `id`
- **THEN** the read returns the record and the consume sets `consumed_at`

#### Scenario: No method saves a record
- **WHEN** the API's exported methods are listed
- **THEN** none saves or edits a statement balance record
