## MODIFIED Requirements

### Requirement: Fork read tools
The server SHALL offer read tools for paychecks, paycheck year-to-date totals and clearing status, business calendars, schedule next dates (relative dates included), an account's budget status (calendar, days early, budget start date and offset), moved-history transactions, a preview of moving an account on budget and the metadata of a transaction's attached documents (`list_transaction_attachments`).

#### Scenario: Year to date
- **GIVEN** a fixture budget with the paycheck "Acme" and posted deposits
- **WHEN** a client calls `get_paycheck_year_to_date` with Acme's `paycheck_id`
- **THEN** it receives the same totals the app shows

#### Scenario: Moved history
- **GIVEN** an account moved on budget with start date 2026-10-01 and 3 transactions before it
- **WHEN** a client calls `list_moved_history` with the account's `account_id`
- **THEN** it receives those 3 transactions and the offset line, and no later ones

#### Scenario: A preview changes nothing
- **WHEN** a client calls `preview_move_on_budget` with that account's `account_id` and a start date
- **THEN** the account is still off budget and no transaction changed

#### Scenario: Attachment metadata
- **GIVEN** a fixture transaction with a PDF attached
- **WHEN** a client calls `list_transaction_attachments` with its `transaction_id`
- **THEN** it receives the file's name, type, size and created time, and no document content
