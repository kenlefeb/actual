## ADDED Requirements

### Requirement: Account maintenance tools
With writes on, the server SHALL offer `write_create_account`, `write_update_account` and `write_reopen_account`, each needing `structure:write`. Each SHALL take ids (never a name) for what it changes, write one audit attempt line and one outcome line, and return the before and after of every field it changed, with the same result as the same action in the app. `write_create_account` SHALL take a name, `off_budget` and an optional opening balance in cents, SHALL refuse an empty name, and SHALL NOT refuse a name another account has, as in the app; the result SHALL then carry a `warnings` note naming that account. `write_update_account` SHALL rename an account and assign it to an account group or take it out of one (`account_group_id` null). The input of every tool here SHALL refuse a key it does not define, so `closed` and the off-budget flag cannot be set through `write_update_account` and `closed` cannot be set through `write_create_account`.

#### Scenario: Create an account with an opening balance
- **WHEN** a client calls `write_create_account` with the name "Holiday Fund", `off_budget` false and `opening_balance` 50000
- **THEN** `list_accounts` lists "Holiday Fund" on budget with balance 500.00, and the call left audit lines

#### Scenario: A duplicate account name is allowed
- **GIVEN** an account "Checking"
- **WHEN** a client calls `write_create_account` with the name "Checking"
- **THEN** a second account "Checking" exists, and the result carries a `warnings` note naming the first account's id

#### Scenario: Update cannot close or move off budget
- **GIVEN** an open on-budget account
- **WHEN** a client calls `write_update_account` with its id and `closed` true, or `off_budget` true
- **THEN** the call is refused, and the account stays open and on budget

#### Scenario: Create cannot be closed
- **WHEN** a client calls `write_create_account` with `closed` true
- **THEN** the call is refused and no account was created

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
`write_close_account` SHALL need `structure:write` and `delete`; `write_delete_account` SHALL need `structure:write`, `delete` and `transactions:write`; both SHALL be annotated destructive. `write_close_account` SHALL close an open account, require `transfer_account_id` when its balance is not zero (an open account other than itself), require `transfer_category_id` exactly when the transfer crosses the on-budget line as the app does, and SHALL refuse an account that is already closed. It SHALL validate everything, including that `transfer_category_id` is an existing category, before the audit attempt line and before the engine call, because the engine unlinks bank sync first and that cannot be undone. `write_delete_account` SHALL delete an open account and all its transactions, as the app's forced close does, and SHALL refuse a closed account ("A closed account can't be deleted; reopen it first"); its outcome SHALL be `failed` unless a read-back shows the account gone. `write_delete_account` SHALL refuse when the account holds a reconciled transaction, or a transfer partner in another account is reconciled, unless the grant allows `allow_reconciled` and the call passes `allow_reconciled: true`, and SHALL refuse when the transactions it deletes plus the partner rows it unlinks exceed the row cap. Descriptions, dry runs and audit lines SHALL say that closing or deleting unlinks the account from bank sync and that the unlink cannot be undone.

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

#### Scenario: A refused close does not unlink
- **GIVEN** a bank-linked account with a balance and a transfer account on the other side of the on-budget line
- **WHEN** a client calls `write_close_account` with a `transfer_category_id` that no category has, or with one when the transfer does not cross the line
- **THEN** the call is refused before any audit line, the account is open, and it is still linked to its bank

#### Scenario: Delete a closed account
- **WHEN** a client calls `write_delete_account` for a closed account
- **THEN** the call is refused saying to reopen it first, and nothing changed

#### Scenario: Delete an open account
- **GIVEN** an open account with 40 unreconciled transactions, one a transfer to "Checking", and a grant with `structure:write delete transactions:write` and `confirm_destructive` off
- **WHEN** a client calls `write_delete_account` for it
- **THEN** the account and its 40 transactions are gone, the transfer's other side in "Checking" remains with no transfer payee, and the audit line records the count 40 and the partner transaction id

#### Scenario: Delete needs transactions:write
- **GIVEN** a connection granted `budget:read structure:write delete`
- **WHEN** the client calls `write_delete_account`
- **THEN** the call fails naming `transactions:write` as missing, and the account is unchanged

#### Scenario: Delete over reconciled rows
- **GIVEN** an open account with a reconciled transaction, and a grant without `allow_reconciled`
- **WHEN** a client calls `write_delete_account` for it, with or without `allow_reconciled: true`
- **THEN** the call is refused and the account and its transactions are unchanged

#### Scenario: Delete with the reconciled override
- **GIVEN** the same account and a grant with `allow_reconciled`
- **WHEN** a client calls `write_delete_account` with `allow_reconciled: true`
- **THEN** the account is deleted, and the audit line records the reconciled counts

#### Scenario: A reconciled transfer partner
- **GIVEN** an account whose only reconciled row is the transfer partner of one of its transactions, in "Checking"
- **WHEN** a client calls `write_delete_account` without the override
- **THEN** the call is refused

#### Scenario: Delete over the row cap
- **GIVEN** a grant with `max_rows` 10 and an account of 11 transactions
- **WHEN** a client calls `write_delete_account` for it
- **THEN** the call is refused and nothing changed

#### Scenario: Dry run then confirm
- **GIVEN** a grant with `structure:write delete transactions:write` and `confirm_destructive`
- **WHEN** the client calls `write_delete_account` for an open account without `confirm`, then again with the returned `confirm`
- **THEN** the first call changes nothing and returns the balance, transaction counts, reconciled counts and `confirm`, and the second deletes the account

#### Scenario: A stale confirm
- **GIVEN** a `confirm` from a dry run of deleting an open account, or of closing one, or of deleting an account group
- **WHEN** a transaction is added to that account (or an account is added to the group) and the client calls with the old `confirm`
- **THEN** the call is refused and the account or group still exists

#### Scenario: The audit line can reconstruct
- **WHEN** a client closes or deletes a bank-linked account
- **THEN** the attempt line records the account's name, off-budget flag, group id, balance, transaction count, bank-link state with the provider name and no token, and the partner transaction ids, and the outcome line records the closing transfer's id in `created`

### Requirement: Account group tools
With writes on, the server SHALL offer `write_create_account_group`, `write_update_account_group` (rename) and `write_delete_account_group`. The first two SHALL need `structure:write`; the delete SHALL need `structure:write` and `delete` and be annotated destructive. A group delete SHALL leave its accounts ungrouped and SHALL follow "Confirm before a destructive write", its dry run listing the accounts it ungroups. An empty group name SHALL be refused, and so SHALL a name another group has (case-insensitive), because the app refuses it. The attempt line of a group delete SHALL record the group's name and the ids of the accounts it ungroups.

#### Scenario: Create and rename
- **WHEN** a client calls `write_create_account_group` with the name "Cash" and then `write_update_account_group` to rename it "Everyday"
- **THEN** `list_account_groups` lists "Everyday", and each call left audit lines

#### Scenario: A duplicate group name
- **GIVEN** a group "Cash"
- **WHEN** a client creates a group named "cash", or renames another group to "CASH"
- **THEN** the call is refused saying the name exists, as the app does, and nothing changed

#### Scenario: Delete a group with accounts
- **GIVEN** a group "Cash" holding "Checking" and "Wallet", and a grant with `structure:write delete` and `confirm_destructive` off
- **WHEN** a client calls `write_delete_account_group` for "Cash"
- **THEN** "Cash" is gone and "Checking" and "Wallet" are open and have no group

#### Scenario: Delete a group without the delete scope
- **GIVEN** a connection granted `budget:read structure:write`
- **WHEN** the client calls `write_delete_account_group`
- **THEN** the call fails naming `delete` as missing, and the group still exists

### Requirement: Account business days tool
`write_set_account_business_days` SHALL need `structure:write` and `schedules:write`. It SHALL take an account id, a business calendar id (or null for Saturday and Sunday) and `deposit_days_early` (a whole number from 0 to 10), set them as the app does, and return the before and after of both. It SHALL report only the paychecks that deposit into the account as affected (with their ids and their next pay and deposit dates before and after, also in the audit line), listing any other paycheck the engine regenerates because it names the account elsewhere as also regenerated. It SHALL refuse, before the engine call and naming the paycheck and the flag `allow_regenerate`, when a paycheck the engine would regenerate has a recorded schedule that no longer exists (so a deleted schedule is not recreated), or when an affected paycheck has a skipped pay date (so a skip is not dropped), unless the call passes `allow_regenerate: true` (default false), which gives the app's own result. A call with `allow_regenerate` that would recreate a missing schedule SHALL also need the `delete` scope, refused as a scope refusal naming `delete` when the grant lacks it; one that only clears a skipped date needs no further scope. The audit line SHALL record `allow_regenerate`, the paychecks and skipped dates affected, and the schedule ids recreated. A call that changes neither value SHALL be refused.

#### Scenario: Two business days early
- **GIVEN** an account "Checking" with no calendar, and the calendar "U.S. Federal Reserve"
- **WHEN** a client calls `write_set_account_business_days` with that calendar and `deposit_days_early` 2
- **THEN** `get_account_budget_status` shows the calendar and 2 days early, and the deposit dates of the paychecks depositing into "Checking" match those the app shows after the same edit

#### Scenario: Only deposit paychecks are counted
- **GIVEN** one paycheck depositing into "Checking" and another that names "Checking" only as its clearing account
- **WHEN** a client sets "Checking"'s days early
- **THEN** the result lists the first as affected with its dates before and after, and the second as also regenerated

#### Scenario: A deleted schedule is not recreated
- **GIVEN** a paycheck depositing into "Checking" whose deposit schedule was deleted
- **WHEN** a client calls `write_set_account_business_days` for "Checking"
- **THEN** the call is refused naming the paycheck, and no schedule was created

#### Scenario: A skip is not dropped
- **GIVEN** a paycheck depositing into "Checking" whose next pay date is skipped
- **WHEN** a client calls `write_set_account_business_days` for "Checking"
- **THEN** the call is refused naming the paycheck, and the skip and the account are unchanged

#### Scenario: Overriding a skip
- **GIVEN** a paycheck depositing into "Checking" whose next pay date is skipped, and a grant with `structure:write schedules:write`
- **WHEN** a client calls `write_set_account_business_days` for "Checking" with `allow_regenerate: true`
- **THEN** the account and the paycheck's schedules are exactly as after the same edit in the app, and the audit line records `allow_regenerate` and the skipped date cleared

#### Scenario: Overriding a missing schedule needs delete
- **GIVEN** a paycheck depositing into "Checking" whose deposit schedule was deleted, and a grant with `structure:write schedules:write` and no `delete`
- **WHEN** a client calls `write_set_account_business_days` with `allow_regenerate: true`
- **THEN** the call is refused naming `delete` as missing, a `refused` audit line is written, and no schedule was created

#### Scenario: Overriding a missing schedule with delete
- **GIVEN** the same paycheck and a grant that also has `delete`
- **WHEN** a client calls it with `allow_regenerate: true`
- **THEN** the schedule is recreated as in the app, and the outcome line records its id in `created`

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
