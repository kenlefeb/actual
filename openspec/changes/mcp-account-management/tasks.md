# Tasks

## 1. Account and group tools (sc-4478)

- [ ] 1.1 Read tools: add `account_group_id` to `list_accounts` and add `list_account_groups` (`budget:read`) in `packages/mcp/src/tools/read/accounts.ts`. Failing tests first for "Account and group reads" (groups listed, ungrouped null, names sanitized)
- [ ] 1.2 `write_create_account`, `write_update_account` and `write_reopen_account` in `packages/mcp/src/tools/write/accounts.ts`, scope `structure:write` (design D1, D4, D5). Failing tests first for every scenario of "Account maintenance tools", including a check that the result matches the app's own `account-create` and `account-update` on the same budget
- [ ] 1.3 `write_create_account_group`, `write_update_account_group` and `write_delete_account_group` (design D3). Failing tests first for every scenario of "Account group tools", including the dry run and the scope refusal
- [ ] 1.4 `write_close_account` and `write_delete_account` (design D3): `structure:write` + `delete`, destructive annotation, dry run and `confirm`, bank-sync note in the description, dry run and audit line. Failing tests first for every scenario of "Account close and delete", including a stale `confirm` and the transfer's other side losing its payee
- [ ] 1.5 `write_set_account_business_days` (design D6), scopes `structure:write` + `schedules:write`. Failing tests first for every scenario of "Account business days tool", comparing paycheck deposit dates with the app's `account-set-business-days` result
- [ ] 1.6 Verify the server's registration test fails for a tool without a scope and passes for the eleven new tools, and that the `delete` tools are annotated destructive in the listing

## 2. Coverage, docs and checks (sc-4478)

- [ ] 2.1 Update `packages/mcp/coverage.json`: replace the two business-days skips with `write_set_account_business_days` and add the account and group handler and method lines. Verify `yarn check:mcp-coverage` fails before and passes after
- [ ] 2.2 Update the tool descriptions and `packages/mcp/README.md` (write and read tool tables, the deletes note that now lists account close and delete, the bank-sync unlink, what is not editable: opening balance, off-budget flag, account order). Verify each README rule matches a spec scenario
- [ ] 2.3 Add a fork news or release note line for the new MCP account tools, and run `yarn generate:fork-news` if the release story needs it
- [ ] 2.4 Run `yarn typecheck`, `yarn lint`, `yarn test` for `@actual-app/mcp`, and `yarn check:mcp-coverage`; all pass

## Workflow follow-up

- File a Backlog story for account order and position (`account-move`) tools; it needs a fork API handler. Other Non-Goals are other stories already.
