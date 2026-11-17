## ADDED Requirements

### Requirement: A reconcile uses only the human's recorded balance
`write_reconcile_account` SHALL take an account id and no statement balance, and SHALL use only the account's usable statement balance record, which a person saved in the app. A call that passes a statement balance SHALL be refused.

#### Scenario: A model passes back the cleared balance
- **WHEN** a client reads the cleared balance and calls the tool with it as `statement_balance`
- **THEN** the call is refused, no confirm is issued and nothing changed

#### Scenario: A recorded balance
- **GIVEN** a usable record of 12,345 cents and cleared rows totalling 12,345
- **WHEN** a client calls the tool and then confirms
- **THEN** the cleared rows are locked against that balance

### Requirement: A reconcile refuses an unusable record
The tool SHALL refuse with fixed text, before any audit line and ending "Nothing changed.", when the account has no record, the record is expired or consumed, or its source is `cleared`, telling the client to ask the user to enter the balance in the app's Reconcile. The none text SHALL name `sync_budget`.

#### Scenario: No record
- **WHEN** a client reconciles an account with no record
- **THEN** it is refused with the none text and nothing changed

#### Scenario: Expired, consumed and echo
- **WHEN** a client reconciles with an expired, a consumed or a cleared-source record
- **THEN** each is refused with its own fixed text and nothing changed

### Requirement: A reconcile shows and audits the record
The dry run and the audit line SHALL carry the record's amount, source, `as_of`, `entered_at`, `entered_by` and age, with `entered_by` as data, and the `plan_digest` SHALL include the record's id, amount, source and `entered_at`.

#### Scenario: The dry run names its source
- **WHEN** a client calls the tool for an account with a bank-sync record
- **THEN** the dry run shows the amount, `bank-sync`, when it was entered and by whom

#### Scenario: The record is replaced between steps
- **WHEN** the app saves a new record after the dry run
- **THEN** the confirm is refused and nothing changed

### Requirement: A lock consumes the record
Inside the write lock the tool SHALL require the record to be unconsumed, unexpired, not `cleared` and equal to the confirmed one. It SHALL consume the record by id whenever rows were locked, even when `verified` is false, and say so in the outcome line; a failed consume SHALL be reported with the rows still locked.

#### Scenario: One entry locks once
- **WHEN** a client reconciles successfully and then calls the tool again
- **THEN** the second call is refused as consumed

#### Scenario: An unverified lock
- **WHEN** the balance no longer matches after rows were locked
- **THEN** the result says `verified: false` and the record is consumed

#### Scenario: Two confirms of one dry run
- **WHEN** a client confirms the same zero-row dry run twice
- **THEN** the second is refused as consumed and nothing changed

### Requirement: The reconciliation read reports the record
`get_account_reconciliation` SHALL return `statement_balance_record` with a `status` of `usable`, `none`, `expired`, `consumed` or `echo`, and the record's source, amount, dates and age when there is one.

#### Scenario: Status of each case
- **WHEN** a client reads an account with an expired record
- **THEN** the status is `expired`
