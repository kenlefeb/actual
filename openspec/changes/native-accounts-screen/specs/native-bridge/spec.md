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
`native/account-register` SHALL return one page of one account's rows per call, newest first, with an opaque cursor for the next page. The first page SHALL add the header and upcoming schedules. The page size SHALL be the synced preference `accounts-register-page-size`, default 50, ceiling 200; a value that is not a whole number from 1 to the ceiling SHALL use the default.

#### Scenario: Paging through a long register
- **GIVEN** an account with 2,000 rows
- **WHEN** native code reads pages until the cursor is null
- **THEN** every row appears exactly once, in the web's order

#### Scenario: A sync adds rows while paging
- **GIVEN** a first page has been read
- **WHEN** a newer row is inserted and the next page is read with the cursor
- **THEN** no row of the next page repeats or is skipped

#### Scenario: The default page size
- **GIVEN** `accounts-register-page-size` is unset
- **WHEN** native code reads a page of a 2,000-row register
- **THEN** the page holds 50 rows

#### Scenario: A changed page size
- **GIVEN** `accounts-register-page-size` is 120
- **THEN** a page holds 120 rows

#### Scenario: A page size over the ceiling or malformed
- **WHEN** the preference is 500, 0, `1e2` or `abc`
- **THEN** a page holds 50 rows

#### Scenario: A forged cursor
- **WHEN** the cursor is not base64 JSON with exactly an integer `date`, a numeric `starting_balance_flag`, a numeric `sort_order` and a string `id`
- **THEN** the call fails and returns no rows

### Requirement: Register scope and search match the web
The register read SHALL filter by scope `all`, `uncleared` or `uncategorized`, and SHALL search payee, category, notes and amount as the web register does, a matching split child returning its parent. A running balance SHALL be filled only for scope `all` with no search while the account shows balances, and be null otherwise.

#### Scenario: Searching
- **GIVEN** a split whose child's notes say "costco"
- **WHEN** native code reads the register with search "costco"
- **THEN** the split parent is a result, as on the web

#### Scenario: Uncategorized
- **WHEN** the scope is `uncategorized`
- **THEN** only rows the web's Uncategorized filter shows are returned

#### Scenario: Search text is data
- **WHEN** the search is `50%_off` or longer than 100 characters
- **THEN** `%` and `_` match literally, every value is a bound parameter, and over 100 characters the call fails

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
Each accounts write SHALL need an undo token, be one undo step, and change nothing unless all is valid. Categorize and delete SHALL refuse a closed account, an id not in it, more ids than `accounts-write-max-ids` (default 100, ceiling 500), and a reconciled row unless `confirmedReconciled === true`. Categorize SHALL refuse splits and off-budget rows. Reopen takes a closed account; move, open ones in a section.

#### Scenario: Another account's row
- **WHEN** a categorize call names one id from another account
- **THEN** the whole call fails and no row changes

#### Scenario: A reconciled row
- **WHEN** a delete call names a reconciled row without `confirmedReconciled`
- **THEN** it is refused; with it true, the row is deleted

#### Scenario: Undo
- **WHEN** native Undo is called with a categorize call's token
- **THEN** every row it changed returns to its category in one step

#### Scenario: Too many ids
- **GIVEN** `accounts-write-max-ids` is unset
- **WHEN** a delete names 80 rows whose children and transfer partners make 120
- **THEN** the whole call fails and nothing is deleted

#### Scenario: A changed limit
- **GIVEN** `accounts-write-max-ids` is 300, or 900 (over the ceiling)
- **THEN** the cap is 300, or the default of 100

#### Scenario: Off-budget or closed
- **WHEN** a categorize call names rows of an off-budget account, or any write names a closed account's rows
- **THEN** it is refused and nothing changes

#### Scenario: A truthy flag
- **WHEN** `confirmedReconciled` is `"true"` or `1`
- **THEN** a reconciled row is refused as if it were false

### Requirement: Deleting a transfer covers its partner
Deleting a transfer row SHALL also delete its partner row in the other account. The register row SHALL name the partner account and whether it is reconciled, so the confirmation names it first. A reconciled partner SHALL need `confirmedReconciled === true`, and partners SHALL count toward `accounts-write-max-ids`.

#### Scenario: A transfer to savings
- **WHEN** the user deletes a transfer from Checking to Savings
- **THEN** the confirmation names Savings, and after confirming both rows are gone; Undo restores both

#### Scenario: A reconciled partner
- **GIVEN** the Savings partner is reconciled and the Checking row is not
- **WHEN** the delete is sent without `confirmedReconciled`
- **THEN** it is refused and neither row changes

### Requirement: Native Undo refuses after later changes
Undoing an accounts write SHALL first check that every row or account it touched still has the category, tombstone and order the write left. If any differs, as after an edit synced from another device, the undo SHALL change nothing and say it can't undo.

#### Scenario: An edit synced in since
- **GIVEN** a native categorize to Groceries, then another device sets one of those rows to Dining and it syncs
- **WHEN** native Undo is called with the categorize token
- **THEN** it is refused, the row stays Dining and no other row changes

#### Scenario: Nothing changed since
- **WHEN** native Undo is called right after the write
- **THEN** every row returns to its earlier state

### Requirement: Web hand-offs are a closed set of messages
The app SHALL send `webAccountAction` to its own page only, with `action` one of `add-account`, `link-account`, `account-settings` or `bank-sync`, and, for the last two, an `account_id` that is a known open account. The page SHALL check the action again, refuse anything else, and open only its existing flow.

#### Scenario: An unknown action
- **WHEN** native code is asked to send `webAccountAction` with action `delete-account`, or `account-settings` with an unknown id
- **THEN** nothing is sent, and the page refuses an action outside the set if one arrives
