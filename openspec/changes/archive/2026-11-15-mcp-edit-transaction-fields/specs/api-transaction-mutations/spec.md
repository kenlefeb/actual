## ADDED Requirements

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
