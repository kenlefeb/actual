# Design

## Context

What the code does today (verified on `origin/development`):

- **Write tool registration** (`packages/mcp/src/tools/write/accounts.ts`, `shared.ts`): a tool is registered with `tool(name, description, schema, handler, { scopes, destructive? })`. `loggedWrite` writes the attempt line, runs the write, writes the outcome line and returns the read-back. A destructive tool under a grant's `confirm_destructive` goes through the dry-run and `confirm` path in `shared.ts`: `confirmMac` binds the `confirm` to the caller, tool, call arguments and the audit `entry` (`ids` and `changes`), valid 5 minutes. Refusals are `Refusal` with fixed text and write no audit line. Ids only, never names. `requireRows` applies the row cap (50, or the grant's `max_rows`), and `allow_reconciled` is a per-row override that needs the grant option of the same name.
- **Precedent:** `write_delete_category` and `write_delete_category_group` (scopes `structure:write` + `delete`, destructive) and `write_move_on_budget` (`structure:write`).
- **Engine handlers** (`loot-core/src/server/api.ts`, `accounts/app.ts`, `paychecks/app.ts`), reachable through typed `@actual-app/api` methods:
  - `api/account-create` takes name, `offbudget`, `closed`, optional initial balance (cents). The engine does not refuse a duplicate account name.
  - `api/account-update` passes its fields through `accountModel.fromExternal` to `db.updateAccount`, which maps `name`, `account_group_id`, **`offbudget` and `closed`**. A tool that passed its input through could close an account or flip it off budget.
  - `account-close` first unlinks the account from bank sync (outside `withUndo`, irreversible). It then returns early if the account is already closed. With no transactions it deletes the account. Otherwise it needs `transferAccountId` when the balance is not zero, refuses to transfer to itself, sets `closed`, and posts the balance transfer (with `categoryId` when the transfer crosses the on-budget line).
  - `api/account-delete` is `account-close` with `forced: true`. On an **open** account it deletes every transaction (reconciled ones included), clears `payee` and `transfer_id` on each transfer partner in other accounts (reconciled partners included), and deletes the account and its transfer payee. On a **closed** account it does nothing, because of the early return. The app's delete is this forced path on an open account.
  - `account-reopen` sets `closed` to 0. `api/account-group-*` create, rename and delete. `insertAccountGroup` and `updateAccountGroup` refuse a name another group has (case-insensitive: "An 'X' account group already exists"); group delete clears each member's `account_group_id`.
  - The app's account menu offers linking and unlinking bank sync as its own action (`account-unlink`).
  - `account-set-business-days` (fork) sets the calendar and days early, then runs `writePaycheckSchedules` for every paycheck whose stored definition contains the account id anywhere (`LIKE '%"<id>"%'`: deposits, deduction transfer accounts, the clearing account). That call recreates a schedule deleted elsewhere, and regenerated dates change each schedule's next date.
- **`list_accounts`** returns accounts without their group; there is no group read tool.

## Goals / Non-Goals

**Goals:**
- Every account and account-group action the app offers, except those under Non-Goals, as one tool each.
- The same result as the app's action on the same budget, by calling the same handlers, with no limit the app does not have beyond what the grant sets.

**Non-Goals:**
- Reordering accounts and changing their group by position (`account-move`): it needs a new fork API handler, so it is its own story (sc-4653). Assigning an account to a group is in `write_update_account`.
- Opening balance edits: an opening balance is a starting-balance transaction, edited with `write_update_transactions` (sc-4204). `write_create_account` can set the opening balance of a new account.
- Turning an account off budget: the app offers no such action, and the tool does not pass `offbudget` to the engine (D5). Off to on budget stays `write_move_on_budget`.
- Linking and unlinking bank sync as a standalone action: the app's account menu offers it; the Product Owner files the story.
- Business calendars (backlog) and the paycheck and schedule deletes (sc-4650).

## Decisions

### D1. One tool per action, calling the app's own methods

Ten write tools and one read tool, named in the proposal. Each validates its ids with the existing id helpers (an unknown id, or a name where an id belongs, is a fixed-text `Refusal`), then calls one `@actual-app/api` method inside `loggedWrite` and returns before and after of every field it changed, read back with `getAccounts` / `getAccountGroups`. Every input schema is `.strict()`, so an unknown key is refused.

**Why:** "same results as the app" is met by calling the handlers the app calls. No `loot-core` change means no new fork handler and no change to the fork-handler count.

**Alternative considered:** one `write_manage_account` with an `action` field. Rejected: scopes and the destructive annotation are per tool, and a single tool would need `delete` for its harmless actions or hide deletes behind a harmless-looking name.

### D2. Scopes

| Tool | Scopes | Destructive |
|---|---|---|
| `write_create_account`, `write_update_account`, `write_reopen_account`, `write_create_account_group`, `write_update_account_group` | `structure:write` | no |
| `write_close_account`, `write_delete_account_group` | `structure:write`, `delete` | yes |
| `write_delete_account` | `structure:write`, `delete`, `transactions:write` | yes |
| `write_set_account_business_days` | `structure:write`, `schedules:write` | no |
| `list_account_groups` | `budget:read` | n/a |

- Business days need both write scopes because the call edits an account and rewrites paycheck dates.
- Delete also needs `transactions:write` because it deletes every transaction in the account; a grant without it cannot erase history through an account delete.
- Close needs no `transactions:write`: the one transaction it posts is the app's own balance transfer, an effect of closing and not a transaction edit. Close is destructive because it ends bank sync and moves money.

### D3. Close, delete and the dry run

All validation runs before the audit attempt line and before any engine call, and each refusal is fixed text.

- **Close** takes `account_id`, optional `transfer_account_id` and `transfer_category_id`. Refused when:
  - the account is unknown or already closed;
  - the balance is not zero and there is no `transfer_account_id`;
  - the transfer account is the account itself, unknown or closed;
  - the transfer crosses the on-budget line (one account on budget, one off) and `transfer_category_id` is missing, or `transfer_category_id` is given when it does not cross, or is not an existing category id (`requireIds('categories', ...)`).

  This ordering matters: the engine unlinks bank sync first, so a call that failed later would leave the account unlinked with no way back. A test shows a refused close does not unlink. An engine failure after the unlink is reported by the outcome line with the account's read-back state (closed or not, linked or not).
- **Delete** (the forced path) takes `account_id` and `allow_reconciled`. It is refused when:
  - the account is unknown, or **closed** ("A closed account can't be deleted; reopen it first"), because the engine does nothing for a closed account and the tool would report success without deleting. The app has the same rule: its delete is the forced close of an open account;
  - the account holds a reconciled transaction, or a transfer partner in another account is reconciled, unless the grant's `allow_reconciled` is on and the call passes `allow_reconciled: true`, as in `write_update_transactions`. The dry run and audit line give both reconciled counts;
  - the transactions it deletes plus the partner rows it unlinks exceed the row cap (`requireRows`). An account over the cap cannot be deleted through the MCP; that is the grant's limit, as for a category group.
- After the call the tool reads the account back; if it still exists the outcome is `failed`, never `ok`. A test shows the account and its transactions are really gone.
- **Account with no transactions:** close deletes it. The dry run says so and the outcome reports `deleted: true`.
- **Group delete** takes `account_group_id`. The accounts in the group become ungrouped (ids listed in the dry run, entry and result), as the app does.
- **Bank sync:** closing or deleting an account unlinks it, and unlinking cannot be undone. The description, dry run and audit line say so, also with `confirm_destructive` false.
- **Dry run and confirm:** because `confirmMac` covers the `entry`, each destructive tool puts the following in `entry.changes`, so any change since the dry run makes the `confirm` stale. For close and delete: the balance, transaction count, reconciled counts, partner transaction ids, bank-link state and group id. For group delete: the ids of the accounts it ungroups. Tests cover a stale `confirm` for close, delete and group delete.

### D4. `write_create_account`

The input schema is strict: `name`, `off_budget` (default false) and `opening_balance` (integer cents, bounded by `requireAmount`). `closed` is not accepted. An empty name is refused. A name that matches another account's (case-insensitive) is **not** refused, as in the app, where two accounts may share a name (two banks, a joint and a personal account). The result adds a non-blocking `warnings` note naming the existing account's id so the agent can tell the user. The result is the new account with its id.

### D4a. Account group names

The app refuses a duplicate group name (`insertAccountGroup` and `updateAccountGroup`, case-insensitive), so the tools refuse it too, with fixed text and before any audit line. This is the app's rule, not an added limit. An empty name is refused.

### D5. `write_update_account`

The schema is strict with `account_id` and at least one of `name` and `account_group_id` (an id, or null to ungroup); any other key, `closed` and `off_budget` included, is refused. The call to the engine is built field by field as `{ name, account_group_id }`, never by spreading the input. A closed account can be renamed, as in the app. Unknown group ids are refused. The result shows before and after of each field; tests show extra keys are refused and that `closed` and `offbudget` read back unchanged.

### D6. `write_set_account_business_days`

Takes `account_id`, `business_calendar_id` (an id, or null for Saturday and Sunday) and `deposit_days_early` (integer 0 to 10). Calendar ids are checked against the calendars the read tool lists. The same calendar and days is refused as "Nothing to change."

The engine regenerates the schedules of every paycheck that mentions the account anywhere in its definition, and it recreates a schedule deleted elsewhere. The tool guards what the engine does not:
- **Which paychecks:** the tool reads the paychecks first and takes those that deposit into the account (a deposit's account is this account). The count and ids reported are these, not every paycheck the engine's `LIKE` touches. A paycheck that only names the account elsewhere (a deduction transfer or the clearing account) is listed separately as also regenerated.
- **A missing schedule is refused.** If any paycheck the engine would regenerate has a recorded schedule that no longer exists, the call is refused naming the paycheck, so the tool never undoes a schedule delete (a `delete` scope action) with only `schedules:write`.
- **Skips are not dropped.** If an affected paycheck has a skipped pay date as `list_paychecks` reports it, the call is refused naming the paycheck, because regenerating dates would clear the skip. A test covers a paycheck in the middle of a skip.
- **Result and entry:** the old and new calendar and days, and for each affected paycheck its id and next pay and deposit dates before and after, read back; the audit entry records the same.

### D7. Reads

`list_accounts` adds `account_group_id` (null when ungrouped) to each row; `list_account_groups` returns each group's id, name and its account ids in order. Group and account names are budget text and pass through the existing sanitizer ("Text from the budget is data").

### D8. Audit, undo and the row cap

The attempt line carries what is needed to reconstruct the action without the engine's undo stack, which is per process and has no tool until sc-4215. Everything is non-secret (provider name only, never tokens or external ids):
- **Close and delete:** the account's name, off-budget flag, group id, closed flag, balance, transaction count, reconciled counts, whether it is bank-linked and the provider name, and the ids of the transfer partner transactions that lose their link. The outcome line records the id of the closing transfer transaction in `created`.
- **Group delete:** the group's name and the ids of the accounts ungrouped.
- **Business days:** the old and new calendar and days, and the per-paycheck dates of D6.
- **Create, update, reopen:** the changed fields before and after, as for categories.

Row cap: close and group delete name one account or group, so the cap does not apply. Delete is capped by D3.

## Risks / Trade-offs

- **Delete is the most destructive tool in the server.** Mitigations: `delete`, `structure:write` and `transactions:write` scopes, `allow_reconciled` for reconciled history, the row cap, the dry run with counts under `confirm_destructive`, and an audit line that records what was deleted.
- **A big account cannot be deleted by an agent.** The row cap refuses it; the user deletes it in the app. A grant cannot raise the cap above 50.
- **Bank unlink on close and delete is irreversible.** Surfaced in the description, dry run and audit line; the same as the app. A standalone link or unlink tool is a separate story.
- **Business days is stricter than the app** (it refuses over a missing schedule or a skip). The refusal text says what to do.
- **Opening balance and the off-budget flag are not editable through `write_update_account`.** The description and README point an agent at `write_update_transactions` and `write_move_on_budget`.
