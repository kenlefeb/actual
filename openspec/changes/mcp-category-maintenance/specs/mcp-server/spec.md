## MODIFIED Requirements

### Requirement: Write tools
With `--writes` on a `staging` or `local` host, the server SHALL offer these write tools and no others: `write_create_transactions`, `write_update_transactions` (category, payee, notes), `write_set_budget_amount`, `write_skip_paycheck`, `write_move_on_budget` and the category maintenance tools of "Category maintenance tools". It SHALL offer no delete other than those, and no bulk-edit, import, rule create or edit, account close, or whole-budget reset or transfer.

#### Scenario: No destructive tools
- **WHEN** a client lists the tools of a server started with `--writes`
- **THEN** the only deleting tools are `write_delete_category` and `write_delete_category_group`, and none imports, bulk-edits, edits rules, closes an account or resets a budget

## ADDED Requirements

### Requirement: Category maintenance tools
With writes on, the server SHALL offer `write_create_category_group`, `write_create_category`, `write_update_category_group`, `write_update_category`, `write_move_category`, `write_move_category_group`, `write_delete_category` and `write_delete_category_group`. Each SHALL take ids (never a name) for what it changes, write one audit attempt line and one outcome line, and return the before and after of every field it changed. `write_update_category` and `write_update_category_group` SHALL rename and hide or unhide (`hidden`). `write_move_category` SHALL change a category's group and its place (before a given category, or last); `write_move_category_group` SHALL change a group's place. A category SHALL stay income or expense as its group is: a new category takes its kind from its group, only expense groups can be created, and a move between an income and an expense group SHALL be refused. A refusal SHALL use fixed text, write no audit line and change nothing.

#### Scenario: Create a group and a category
- **WHEN** a client calls `write_create_category_group` with the name "Pets" and then `write_create_category` with the name "Vet" and that group's id
- **THEN** both are listed by `list_category_groups`, "Vet" under "Pets" and as an expense category, and each call left audit lines

#### Scenario: Rename, hide and unhide
- **WHEN** a client calls `write_update_category` to rename "Vet" to "Veterinarian" and to hide it, and later to unhide it
- **THEN** each result shows the old and new name or `hidden` value, and `list_category_groups` shows the current ones

#### Scenario: Move and reorder
- **GIVEN** categories "A", "B" in group "X" and "C" in group "Y"
- **WHEN** a client moves "C" into "X" before "A", and then moves group "Y" before group "X"
- **THEN** `list_category_groups` lists "Y" before "X" and "X" holds "C", "A", "B" in that order

#### Scenario: A duplicate name
- **GIVEN** a category "Dining" in group "Food"
- **WHEN** a client creates or renames another category in "Food" to "dining", or creates a group named like an existing one
- **THEN** the call is refused saying the name exists and nothing changed

#### Scenario: An unknown id or a name
- **WHEN** a client passes an id that no category or group has, or a category's name where an id is required
- **THEN** the call is refused and nothing changed

#### Scenario: Income and expense are not mixed
- **WHEN** a client moves an expense category into the income group, or an income category into an expense group
- **THEN** the call is refused and the category stays where it was

### Requirement: Category delete needs a transfer when in use
`write_delete_category` SHALL delete a category. When the category has transactions or non-zero budgeted amounts it SHALL require `transfer_category_id`, refusing without one and saying how many transactions and which months are affected; with one it SHALL move the transactions and budgeted amounts to that category before deleting. The transfer category SHALL exist, differ from the deleted one and be income or expense as it is. A category in use SHALL be deleted without a dry-run or confirm step. `write_delete_category_group` SHALL refuse a group that still has categories, hidden ones included, saying how many, and SHALL refuse the income group.

#### Scenario: In use, no transfer
- **GIVEN** category "Dining" with 12 transactions
- **WHEN** a client calls `write_delete_category` without `transfer_category_id`
- **THEN** the call is refused naming 12 transactions and the budgeted months, and "Dining" still exists with its transactions

#### Scenario: In use, with a transfer
- **GIVEN** "Dining" with transactions and budgeted amounts, and "Groceries"
- **WHEN** a client calls `write_delete_category` for "Dining" with the id of "Groceries"
- **THEN** "Dining" is gone, its transactions are categorized "Groceries", and its budgeted amounts are added to those of "Groceries"

#### Scenario: Not in use
- **WHEN** a client deletes a category with no transactions and no budgeted amounts, without a transfer
- **THEN** the category is deleted

#### Scenario: A transfer of the other kind
- **WHEN** a client deletes an expense category with the id of an income category as the transfer
- **THEN** the call is refused and nothing changed

#### Scenario: A group that is not empty
- **GIVEN** group "Food" holding two categories
- **WHEN** a client calls `write_delete_category_group` for "Food"
- **THEN** the call is refused saying the group has 2 categories, and "Food" still exists

#### Scenario: An empty group
- **WHEN** a client calls `write_delete_category_group` for a group with no categories
- **THEN** the group is deleted and an audit line names it

### Requirement: The category list shows kind and visibility
`list_category_groups` SHALL return every group, hidden ones included, in the budget's order, each with its `id`, `is_income` and `hidden`, and its categories in the budget's order each with `id`, `is_income` and `hidden`.

#### Scenario: Hidden and income
- **GIVEN** a hidden category and the income group
- **WHEN** a client calls `list_category_groups`
- **THEN** the hidden category appears with `hidden` true, and the income group's categories show `is_income` true
