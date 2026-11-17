## ADDED Requirements

### Requirement: Undelete rows
`@actual-app/api` SHALL export `undeleteRows`, calling the fork handler `undelete-rows`, which un-deletes named rows of `categories`, `category_groups`, `transactions` and `transaction_attachments`. The handler SHALL reject the whole call, changing nothing, when `budget_id` is not the loaded budget's or any named row is missing or not deleted, read by the handler itself. It runs no rules and no transfer hooks.

#### Scenario: A deleted transaction comes back
- **GIVEN** a transaction deleted through `deleteTransaction`
- **WHEN** a script calls `undeleteRows` with its id
- **THEN** the transaction is back with the same id and values, and no rule ran

#### Scenario: A live or unknown row
- **WHEN** a script names a live transaction, or an id the budget lacks
- **THEN** the call rejects and nothing changed

#### Scenario: A table outside the list
- **WHEN** a script calls `undeleteRows` naming an `accounts` row
- **THEN** the call rejects and nothing changed

### Requirement: Undelete sets only fixed columns
`undelete-rows` SHALL set, by API name through the schema (`transfer_id` is stored as `transferred_id`, `payee` as `description`), only: `transfer_id` on a row it un-deletes or on the live split child the delete unlinked, when the two name each other; `payee` on that child, only to the restored row's account's transfer payee; and an existing `category_mapping` row's `transferId`, only to a category it un-deletes. Anything else rejects the whole call.

#### Scenario: Relinking a live row
- **WHEN** a script sets `transfer_id` on a live transaction that is not the unlinked partner of a row in the call
- **THEN** the call rejects and nothing changed

#### Scenario: A mapping to another category
- **WHEN** a script sets a mapping's `transferId` to a category not un-deleted in the call
- **THEN** the call rejects and nothing changed

### Requirement: Undelete restores rows and cells together
`undelete-rows` SHALL set the named budget cells through the budget actions in the same batch as the rows, so all apply or none do. With `check: true` it SHALL change nothing and return each named row's existence, deleted state and the columns it may set. The API test's handler list grows by one.

#### Scenario: A failure changes nothing
- **WHEN** the handler fails while applying a call with rows and cells
- **THEN** no row and no cell changed

#### Scenario: Check mode
- **WHEN** a script calls `undeleteRows` with `check: true`
- **THEN** it returns the rows' state and nothing changed
