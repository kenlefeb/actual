## ADDED Requirements

### Requirement: Account maintenance tools
With writes on, the server SHALL offer `write_create_account`, `write_update_account` and `write_reopen_account`, each needing `structure:write`. Each SHALL take ids (never a name) for what it changes, write one audit attempt line and one outcome line, and return the before and after of every field it changed, with the same result as the same action in the app. `write_create_account` SHALL take a name, `off_budget` and an optional opening balance in cents, and refuse an empty name or a name an account already has (case-insensitive). `write_update_account` SHALL rename an account and assign it to an account group or take it out of one (`account_group_id` null), and SHALL NOT change its opening balance or off-budget flag.

#### Scenario: Create an account with an opening balance
- **WHEN** a client calls `write_create_account` with the name "Holiday Fund", `off_budget` false and `opening_balance` 50000
- **THEN** `list_accounts` lists "Holiday Fund" on budget with balance 500.00, and the call left audit lines

#### Scenario: A duplicate name
- **GIVEN** an account "Checking"
- **WHEN** a client calls `write_create_account` with the name "checking"
- **THEN** the call is refused saying the name exists, and nothing changed

#### Scenario: Rename and group
- **GIVEN** an account "Checking" and an account group "Cash"
- **WHEN** a client calls `write_update_account` with the account's id, the name "Everyday" and the group's id, and later with `account_group_id` null
- **THEN** each result shows the old and new name and group, and `list_accounts` shows the current ones

#### Scenario: Reopen a closed account
- **GIVEN** a closed account
- **WHEN** a client calls `write_reopen_account` with its id
- **THEN** the account is open and the result shows `closed` true before and false after

#### Scenario: An unknown id or a name
- **WHEN** a client passes an account id that no account has, or an account's name where an id is required
- **THEN** the call is refused and nothing changed

### Requirement: Account close and delete
`write_close_account` and `write_delete_account` SHALL each need `structure:write` and `delete` and be annotated destructive. `write_close_account` SHALL close an open account, require `transfer_account_id` when its balance is not zero (an open account other than itself), require `transfer_category_id` when the transfer crosses the on-budget line as the app does, and SHALL refuse an account that is already closed. `write_delete_account` SHALL delete a closed account and all its transactions, refusing an open one ("Close the account first"). Both descriptions, dry runs and audit lines SHALL say that closing or deleting unlinks the account from bank sync and that the unlink cannot be undone. Under `confirm_destructive` each SHALL follow "Confirm before a destructive write", the dry run stating the account's balance and transaction count.

#### Scenario: Close with a balance
- **GIVEN** an open account "Old Savings" with balance 120.00 and an open account "Checking"
- **WHEN** a client calls `write_close_account` for "Old Savings" with `transfer_account_id` of "Checking"
- **THEN** "Old Savings" is closed with balance 0.00 and "Checking" is 120.00 higher

#### Scenario: Close with a balance and no transfer
- **WHEN** a client calls `write_close_account` for an account with a balance of 120.00 and no `transfer_account_id`
- **THEN** the call is refused saying a transfer account is required, and the account is open

#### Scenario: Close needs the delete scope
- **GIVEN** a connection granted `budget:read structure:write`
- **WHEN** the client calls `write_close_account`
- **THEN** the call fails naming `delete` as missing, and the account is open

#### Scenario: Delete an open account
- **WHEN** a client calls `write_delete_account` for an open account with transactions
- **THEN** the call is refused saying to close it first, and the account and its transactions are unchanged

#### Scenario: Delete a closed account
- **GIVEN** a closed account with 40 transactions, one a transfer to "Checking", and a grant with `structure:write delete` and `confirm_destructive` off
- **WHEN** a client calls `write_delete_account` for it
- **THEN** the account and its 40 transactions are gone, the transfer's other side in "Checking" remains with no transfer payee, and the audit line records the count 40

#### Scenario: Dry run then confirm
- **GIVEN** a grant with `structure:write delete` and `confirm_destructive`
- **WHEN** the client calls `write_delete_account` for a closed account without `confirm`, then again with the returned `confirm`
- **THEN** the first call changes nothing and returns the balance, transaction count and `confirm`, and the second deletes the account

#### Scenario: A stale confirm
- **GIVEN** a `confirm` from a dry run of deleting a closed account
- **WHEN** a transaction is added to that account and the client calls with the old `confirm`
- **THEN** the call is refused and the account still exists

### Requirement: Account group tools
With writes on, the server SHALL offer `write_create_account_group`, `write_update_account_group` (rename) and `write_delete_account_group`. The first two SHALL need `structure:write`; the delete SHALL need `structure:write` and `delete` and be annotated destructive. A group delete SHALL leave its accounts ungrouped and SHALL follow "Confirm before a destructive write", its dry run listing the accounts it ungroups. An empty or duplicate group name SHALL be refused.

#### Scenario: Create and rename
- **WHEN** a client calls `write_create_account_group` with the name "Cash" and then `write_update_account_group` to rename it "Everyday"
- **THEN** `list_account_groups` lists "Everyday", and each call left audit lines

#### Scenario: Delete a group with accounts
- **GIVEN** a group "Cash" holding "Checking" and "Wallet", and a grant with `structure:write delete` and `confirm_destructive` off
- **WHEN** a client calls `write_delete_account_group` for "Cash"
- **THEN** "Cash" is gone and "Checking" and "Wallet" are open and have no group

#### Scenario: Delete a group without the delete scope
- **GIVEN** a connection granted `budget:read structure:write`
- **WHEN** the client calls `write_delete_account_group`
- **THEN** the call fails naming `delete` as missing, and the group still exists

### Requirement: Account business days tool
`write_set_account_business_days` SHALL need `structure:write` and `schedules:write`. It SHALL take an account id, a business calendar id (or null for Saturday and Sunday) and `deposit_days_early` (a whole number from 0 to 10), set them as the app does, and return the before and after of both and how many paychecks were regenerated. A call that changes neither value SHALL be refused.

#### Scenario: Two business days early
- **GIVEN** an account "Checking" with no calendar, and the calendar "U.S. Federal Reserve"
- **WHEN** a client calls `write_set_account_business_days` with that calendar and `deposit_days_early` 2
- **THEN** `get_account_budget_status` shows the calendar and 2 days early, and the deposit dates of the paychecks depositing into "Checking" match those the app shows after the same edit

#### Scenario: Out of range
- **WHEN** a client calls it with `deposit_days_early` 11, or with a calendar id that no calendar has
- **THEN** the call is refused and nothing changed

#### Scenario: Both scopes are needed
- **GIVEN** a connection granted `budget:read structure:write`
- **WHEN** the client calls `write_set_account_business_days`
- **THEN** the call fails naming `schedules:write` as missing, and the account is unchanged

### Requirement: Account and group reads
`list_accounts` SHALL include each account's `account_group_id` (null when ungrouped), and the server SHALL offer `list_account_groups` (`budget:read`), returning each group's id, name and the ids of its accounts in order. Names SHALL be returned as budget text under "Text from the budget is data".

#### Scenario: Groups are listed
- **GIVEN** a group "Cash" holding "Checking", and an ungrouped account "Wallet"
- **WHEN** a client calls `list_account_groups` and `list_accounts`
- **THEN** the first lists "Cash" with the id of "Checking", and the second shows `account_group_id` for "Checking" and null for "Wallet"

### Requirement: Coverage for account tools
Each account and account-group handler and API method the tools above call SHALL have its `packages/mcp/coverage.json` line naming its tool, and the skips for `account-set-business-days` and `setAccountBusinessDays` SHALL be replaced by those lines. A skip SHALL NOT cite safety.

#### Scenario: The coverage check passes
- **WHEN** `yarn check:mcp-coverage` runs on this change
- **THEN** it passes, and `account-set-business-days` maps to `write_set_account_business_days`
