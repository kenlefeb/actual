# Design

## Context

What the code does today:

- **Write tool registration** (`packages/mcp/src/tools/write/accounts.ts`, `shared.ts`): a tool is registered with `tool(name, description, schema, handler, { scopes, destructive? })`. `loggedWrite` writes the attempt line, runs the write, writes the outcome line and returns the read-back. A destructive tool under a grant's `confirm_destructive` goes through the dry-run and `confirm` path in `shared.ts` (confirm bound to caller, tool, arguments and budget state, valid 5 minutes). Refusals are `Refusal` with fixed text and write no audit line. Ids only, never names.
- **Precedent:** `write_delete_category` and `write_delete_category_group` (scopes `structure:write` + `delete`, destructive) and `write_move_on_budget` (`structure:write`).
- **Engine handlers** (`loot-core/src/server/api.ts`, `accounts/app.ts`), all reachable through typed `@actual-app/api` methods:
  - `api/account-create` takes name, `offbudget`, optional initial balance (cents).
  - `api/account-update` sets name and `account_group_id`.
  - `account-close` is the app's close. With no transactions it deletes the account. Otherwise it needs `transferAccountId` when the balance is not zero, refuses to transfer to itself, then sets `closed` and posts the balance transfer (with `categoryId` when the transfer crosses the on-budget line). It first unlinks the account from bank sync, which is not undoable. The rest is `withUndo`.
  - `api/account-delete` is `account-close` with `forced: true`: every transaction in the account is deleted, the other side of each transfer loses its payee and link, and the account and its transfer payee are deleted.
  - `account-reopen` sets `closed` to 0. `api/account-group-*` create, rename and delete.
  - `account-set-business-days` (fork) sets the calendar and days early and regenerates the paychecks that deposit into the account.
- **`list_accounts`** returns accounts without their group; there is no group read tool.

## Goals / Non-Goals

**Goals:**
- Every account and account-group action the app offers, except those under Non-Goals, as one tool each.
- The same result as the app's action on the same budget, by calling the same handlers.

**Non-Goals:**
- Reordering accounts and changing their group by position (`account-move`): it needs a new fork API handler and method, so it is a Backlog story. Assigning an account to a group is in `write_update_account`.
- Opening balance edits: an opening balance is a starting-balance transaction, edited with `write_update_transactions` (sc-4204). `write_create_account` can set the opening balance of a new account.
- Turning an on-budget account off budget: the engine's `account-update` does not change `offbudget` and the app offers no such action. Off to on budget stays `write_move_on_budget`, so `write_update_account` does not take `off_budget`.
- Business calendars (backlog) and the paycheck and schedule deletes (sc-4650).

## Decisions

### D1. One tool per action, calling the app's own methods

Ten write tools and one read tool, named in the proposal. Each validates its ids with the existing id helpers (an unknown id, or a name where an id belongs, is a fixed-text `Refusal`), then calls one `@actual-app/api` method inside `loggedWrite` and returns before and after of every field it changed, read back with `getAccounts` / `getAccountGroups`.

**Why:** the story requires "same results as the app"; calling the handlers the app calls gets that, including `withUndo`, so sc-4215's Undo reverses these as it does the app's own action. No `loot-core` change means no new fork handler and no change to the fork-handler count.

**Alternative considered:** one `write_manage_account` with an `action` field. Rejected: scopes and the destructive annotation are per tool, and a single tool would need `delete` for its harmless actions or hide deletes behind a harmless-looking name.

### D2. Scopes

| Tool | Scopes | Destructive |
|---|---|---|
| `write_create_account`, `write_update_account`, `write_reopen_account`, `write_create_account_group`, `write_update_account_group` | `structure:write` | no |
| `write_close_account`, `write_delete_account`, `write_delete_account_group` | `structure:write`, `delete` | yes |
| `write_set_account_business_days` | `structure:write`, `schedules:write` | no |
| `list_account_groups` | `budget:read` | n/a |

Business days need both write scopes because the call edits an account (structure) and rewrites paycheck deposit dates (schedules and paychecks). A grant holding only one cannot reach a change in the other area through this tool. Close is destructive because it ends bank sync and moves money; the spec rule "a tool that deletes, closes or merges needs its area's write scope and `delete`" already requires it.

### D3. Close, delete and the dry run

- **Close** takes `account_id`, optional `transfer_account_id` and `transfer_category_id`. Fixed-text refusals before the audit line: the account is already closed; the balance is not zero and there is no `transfer_account_id`; the transfer account is the account itself, closed, or does not exist; the transfer crosses the on-budget line and `transfer_category_id` is missing (as the app's modal asks). The dry run reports the balance, the transaction count, the transfer, the category and that bank sync will be unlinked.
- **Delete** takes `account_id` and requires the account to be closed, as the app offers delete on closed accounts. An open account is refused with "Close the account first." The dry run reports the transaction count and the transfer transactions in other accounts that lose their link and payee.
- **Account with no transactions:** the engine deletes it on close. The tool reports `deleted: true` in the outcome and the dry run says so.
- **Group delete** takes `account_group_id`. The accounts in the group become ungrouped (listed in the dry run and read back in the result), as the app does.
- **Bank sync:** closing or deleting an account unlinks it, and unlinking cannot be undone and has to be redone by hand with the provider. The tool description, the dry run and the audit line say so. This is accurate to the app, which does the same.
- All three use the existing dry-run and `confirm` path unchanged, so a stale `confirm` (a transaction added since) is refused.

### D4. `write_create_account`

Takes `name` (non-empty, bounded length as category names are), `off_budget` (boolean, default false) and `opening_balance` (integer cents, bounded by `requireAmount`, default none). An empty name is refused, and so is a name equal to another account's (case-insensitive). The app allows duplicates; the tool is stricter because an agent matches nothing by name and a duplicate makes the read tools ambiguous for the user. The result is the new account with its id.

### D5. `write_update_account`

Takes `account_id` and at least one of `name` and `account_group_id` (an id, or null to ungroup). A closed account can be renamed, as in the app. Unknown group ids are refused. The result shows before and after of each field.

### D6. `write_set_account_business_days`

Takes `account_id`, `business_calendar_id` (an id, or null for Saturday and Sunday) and `deposit_days_early` (integer 0 to 10, as `account-business-days` bounds it). Calendar ids are checked against the business calendars the read tool lists. The result shows before and after of both fields and the count of paychecks regenerated, read back by comparing the paychecks that deposit into the account before and after. The same calendar and days is a no-op and is refused as "Nothing to change."

### D7. Reads

`list_accounts` adds `account_group_id` (null when ungrouped) to each row; `list_account_groups` returns each group's id, name and its account ids in order. Group and account names are budget text and pass through the existing sanitizer ("Text from the budget is data").

### D8. Audit, undo and the row cap

Each write logs one attempt line (ids and changes) and one outcome line. Account tools name one account, so the row cap does not apply, but a delete's attempt line records the transaction count it removes. Undo: the engine registers these actions in its undo stack as for the app (sc-4215 adds the tool that uses it). The one non-undoable part, the bank unlink, is stated in D3.

## Risks / Trade-offs

- **Delete is the most destructive tool in the server** (it deletes every transaction in an account). Mitigations: `delete` plus `structure:write`, a closed account required, the dry run with counts under `confirm_destructive`, and the audit line with the count. A grant that does not want this omits `delete`.
- **Stricter than the app on duplicate account names** (D4). Mitigation: a fixed-text refusal that says the name exists.
- **Bank unlink on close is irreversible** (D3). Surfaced in the description and dry run; the same as the app.
- **Opening balance and the off-budget flag are not editable through `write_update_account`.** The tool description and README point an agent at `write_update_transactions` and `write_move_on_budget`.
