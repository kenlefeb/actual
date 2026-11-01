# Spec Delta

## ADDED Requirements

### Requirement: A read-only session writes nothing
`init` SHALL accept `readOnly: true`. In a read-only session the engine SHALL NOT run schedule auto-posting, the paycheck reconcile and backfill or the sync-time parent-id repair, SHALL NOT upload the budget file, SHALL NOT save `lastScheduleRun`, and SHALL push no messages. Reads and pulling the server's changes SHALL work as usual, and without the option behavior SHALL be unchanged.

#### Scenario: A read-only session posts nothing
- **GIVEN** a budget with an auto-post schedule that is due today, loaded with `init({ readOnly: true })` against a sync server
- **WHEN** a sync succeeds
- **THEN** the schedule posted no transaction, `lastScheduleRun` is not saved, and the sync server received no messages from this client

#### Scenario: A read-only session uploads no budget file
- **GIVEN** a budget whose `lastUploaded` is older than the upload interval, loaded with `init({ readOnly: true })` against a sync server
- **WHEN** the budget loads
- **THEN** the sync server receives no upload of the budget file, and `lastUploaded` is unchanged

#### Scenario: A read-only session sends no repair messages
- **GIVEN** a child transaction with no parent id arrives by sync in a read-only session
- **WHEN** the sync succeeds
- **THEN** no repair message is created and nothing is pushed

#### Scenario: A normal session still posts
- **GIVEN** the same budget loaded without `readOnly`
- **WHEN** a sync succeeds
- **THEN** the due schedule posts its transaction and the client pushes the message, as the app does

#### Scenario: A read-only session does not reconcile paycheck edits
- **GIVEN** paycheck edits from another device arrive by sync in a read-only session
- **WHEN** the sync succeeds
- **THEN** no schedule is created, changed or deleted locally, and nothing is pushed

#### Scenario: A normal session still uploads
- **GIVEN** the same budget loaded without `readOnly`
- **WHEN** the budget loads
- **THEN** the budget file is uploaded, as the app does

#### Scenario: A read-only session still pulls
- **GIVEN** another device added a transaction
- **WHEN** a sync succeeds in a read-only session
- **THEN** the transaction is readable locally
