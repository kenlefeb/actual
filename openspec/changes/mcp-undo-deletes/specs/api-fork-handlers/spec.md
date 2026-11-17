## ADDED Requirements

### Requirement: Undelete rows
`@actual-app/api` SHALL export `undeleteRows`, calling the fork handler `undelete-rows`, which un-deletes named ids of `categories`, `category_groups`, `transactions` and `transaction_attachments` and sets only `category_mapping.transferId`, `transactions.transfer_id` and `transactions.payee`, in one batch, without rules or transfer hooks. Any other table or column SHALL reject the whole call. The listed handlers in the API test grow by one.

#### Scenario: A deleted transaction comes back
- **GIVEN** a transaction deleted through `deleteTransaction`
- **WHEN** a script calls `undeleteRows` with its id
- **THEN** the transaction is back with the same id and values, and no rule ran

#### Scenario: A table outside the list
- **WHEN** a script calls `undeleteRows` naming an `accounts` row
- **THEN** the call rejects and nothing changed
