## ADDED Requirements

### Requirement: The accounts list is one batched read
`native/accounts-list` SHALL return, in one message, every account with its balance, section and detail fields, the on-budget, off-budget and closed totals, net worth and the budget's currency fields. Every number SHALL equal what the web Accounts screen shows for the same budget.

#### Scenario: A budget with open and closed accounts
- **GIVEN** on-budget, off-budget and closed accounts with transactions
- **WHEN** native code calls `native/accounts-list`
- **THEN** each balance and each section total equals the web's, and net worth is the open accounts' sum

#### Scenario: The shape changes
- **GIVEN** the contract fixture checked by vitest and decoded by the Swift tests
- **WHEN** the handler's output shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

### Requirement: A register page is one read with a keyset cursor
`native/account-register` SHALL return one page of one account's rows per call, newest first, with an opaque cursor for the next page. The first page SHALL add the working, cleared and uncleared header and the upcoming schedules. `limit` SHALL default to 50 with a ceiling of 200; any other value SHALL use the default.

#### Scenario: Paging through a long register
- **GIVEN** an account with 2,000 rows
- **WHEN** native code reads pages until the cursor is null
- **THEN** every row appears exactly once, in the web's order

#### Scenario: A sync adds rows while paging
- **GIVEN** a first page has been read
- **WHEN** a newer row is inserted and the next page is read with the cursor
- **THEN** no row of the next page repeats or is skipped

#### Scenario: A bad limit
- **WHEN** `limit` is 0, 500 or a string
- **THEN** the page holds 50 rows

### Requirement: Register scope and search match the web
The register read SHALL filter by scope `all`, `uncleared` or `uncategorized`, and SHALL search payee, category, notes and amount as the web register does, a matching split child returning its parent. A running balance SHALL be filled only for scope `all` with no search while the account shows balances, and be null otherwise.

#### Scenario: Searching
- **GIVEN** a split whose child's notes say "costco"
- **WHEN** native code reads the register with search "costco"
- **THEN** the split parent is a result, as on the web

#### Scenario: Uncategorized
- **WHEN** the scope is `uncategorized`
- **THEN** only rows the web's Uncategorized filter shows are returned

#### Scenario: Running balance while filtered
- **WHEN** the scope is `uncleared` or a search is set
- **THEN** every row's running balance is null

### Requirement: The accounts reads meet the latency gate
The perf suite SHALL time `native/accounts-list` on 50 accounts and `native/account-register` for a first page and for a page 10,000 rows deep of a 20,000-row account, with and without search, and SHALL fail when a median exceeds 50 ms.

#### Scenario: The gate runs in CI
- **WHEN** Fork CI runs `yarn workspace @actual-app/core run perf`
- **THEN** it prints each median and p95, and fails if a median is over 50 ms

### Requirement: The accounts handlers are allowlisted
The bridge allowlist SHALL add `native/accounts-list`, `native/account-register`, `native/transactions-categorize`, `native/transactions-delete`, `native/account-reopen` and `native/account-move` in the Swift list and the page's list, which SHALL stay equal. Each SHALL have a `coverage.json` skip. No other handler SHALL join the list.

#### Scenario: An allowlisted accounts read
- **WHEN** native code calls `native/accounts-list`
- **THEN** loot-core runs it and native receives the list

#### Scenario: The raw handler
- **WHEN** native code calls `account-reopen` or `transactions-batch-update`
- **THEN** the call is refused before it reaches the page

### Requirement: Accounts writes are scoped, confirmed and undoable
Each accounts write SHALL require an undo token, be one undo step and change nothing unless every argument is valid. Categorize and delete SHALL refuse an id not in `account_id`, and a reconciled row unless `confirmedReconciled` is true; categorize SHALL refuse a split row. Reopen SHALL take only a closed account; move only open accounts in one section.

#### Scenario: Another account's row
- **WHEN** a categorize call names one id from another account
- **THEN** the whole call fails and no row changes

#### Scenario: A reconciled row
- **WHEN** a delete call names a reconciled row without `confirmedReconciled`
- **THEN** it is refused; with it true, the row is deleted

#### Scenario: Undo
- **WHEN** native Undo is called with a categorize call's token
- **THEN** every row it changed returns to its category in one step
