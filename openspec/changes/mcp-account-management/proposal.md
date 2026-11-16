# Proposal

## Why

Story sc-4478, part of the sc-4203 parity umbrella. Ken's rule (2026-11-15): an agent can do in the MCP whatever he can do in the app, and the limits come from the grant (sc-4477), not from missing tools. Accounts have no write tools except `write_move_on_budget`: an agent cannot create, rename, close, reopen or delete an account, manage account groups, or set an account's business days. Paycheck create and delete and schedule delete are sc-4650, not here.

## What Changes

- **Ten write tools**, each one app action, each declaring its scope at registration, each with its `packages/mcp/coverage.json` line:
  - `write_create_account` (`structure:write`): name, off-budget flag, optional opening balance in cents.
  - `write_update_account` (`structure:write`): rename, and assign to an account group or take out of one.
  - `write_close_account` (`structure:write` + `delete`, destructive): closes an account, moving any balance to a named account.
  - `write_reopen_account` (`structure:write`): reopens a closed account.
  - `write_delete_account` (`structure:write` + `delete` + `transactions:write`, destructive): deletes an open account and its transactions, as the app's forced close does; refused over reconciled rows without `allow_reconciled`, and capped by the row limit.
  - `write_set_account_business_days` (`structure:write` + `schedules:write`): the account's business calendar and days early; regenerates the deposit dates of the paychecks that deposit into it, as the app does.
  - `write_create_account_group`, `write_update_account_group` (rename) (`structure:write`).
  - `write_delete_account_group` (`structure:write` + `delete`, destructive): the accounts in it become ungrouped.
- **One new read tool**, `list_account_groups` (`budget:read`), and `list_accounts` gains `account_group_id`, so an agent can find the ids the writes need.
- **Same results as the app.** Each tool calls the app's own handler through the existing `@actual-app/api` methods (`createAccount`, `updateAccount`, `closeAccount`, `reopenAccount`, `deleteAccount`, the group methods and `setAccountBusinessDays`), so validation, undo registration and sync are the engine's.
- **Destructive tools follow the existing pattern.** Close, delete and group delete need `delete` plus `structure:write`, are annotated destructive, write an attempt and an outcome audit line, and under `confirm_destructive` return a dry run (what would change, with counts) and a `confirm` first.
- **coverage.json.** The skips for `account-set-business-days` and `setAccountBusinessDays` become tool lines, and lines for the account and group handlers are added. No skip cites safety.

Mobile scope: none. The MCP server and the API have no UI, so this change is exempt from the desktop and mobile rule.

Not in this change (each its own story, or a decision recorded in the design): reordering accounts and moving them between groups by position (`account-move`, sc-4653); linking and unlinking an account's bank sync as a standalone action (the app's account menu offers it; the Product Owner files the story); editing an opening balance (a starting-balance transaction edit, sc-4204); flipping an account off budget (the app does not offer it); paycheck create and delete and schedule delete (sc-4650); business calendars (backlog); the Undo tool (sc-4215).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Account maintenance tools", "Account close and delete", "Account group tools", "Account business days tool", "Account and group reads" and "Coverage for account tools". The existing "Write tools", "Every tool declares a scope" and "Coverage manifest" rules apply to the new tools unchanged, so no existing requirement text changes.

## Impact

- **Code:**
  - `packages/mcp/src/tools/write/accounts.ts` (new tools) and its tests; `packages/mcp/src/tools/read/accounts.ts` (`list_account_groups`, `account_group_id`).
  - `packages/mcp/coverage.json` and `packages/mcp/README.md`.
  - No `loot-core` or `@actual-app/api` change: every method already exists, so the fork-handler count is unchanged.
- **Reviews:** Tester; Solution Architect; Security Analyst (new destructive tools and a bank-sync side effect on close). The Product Owner reviews intent.
- **Ordering:** none. The specs here only add requirements, so this change does not wait for `mcp-edit-transaction-fields` to archive.

## Decisions for Ken

None. The calls made in the design (D2 scopes, D3 delete's reconciled and row-cap rules, D6 business-days refusals) are Architect decisions and can be overturned in review.
