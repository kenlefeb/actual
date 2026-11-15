## ADDED Requirements

### Requirement: Several transactions update as one batch
The API's `updateTransactions` SHALL take a list of transaction ids with partial fields, apply them in order to the transactions and their splits as the app's own edit does, and write the result in one batch, so either every change is made or none is. It SHALL resolve with the updated transactions, and transfers SHALL follow as for a single update.

#### Scenario: A split's parent and children together
- **GIVEN** a split of -100.00 with children -60.00 and -40.00
- **WHEN** a script calls `updateTransactions` with the parent's amount -120.00 and the first child's amount -80.00
- **THEN** the parent is -120.00, the children are -80.00 and -40.00, and the split shows no error

#### Scenario: One update fails
- **GIVEN** two updates where the second names a transaction that does not exist
- **WHEN** a script calls `updateTransactions`
- **THEN** the call rejects and the first transaction is unchanged

#### Scenario: A transfer follows
- **GIVEN** a transfer of -50.00 from "Checking" to "Savings"
- **WHEN** a script calls `updateTransactions` to set the Checking side's amount to -75.00 and its date to 2026-11-14
- **THEN** the Savings side is 75.00 on 2026-11-14
