# Tasks

## 1. Account and group tools (sc-4478)

- [ ] 1.1 Read tools: add `account_group_id` to `list_accounts` and add `list_account_groups` (`budget:read`) in `packages/mcp/src/tools/read/accounts.ts`. Failing tests first for "Account and group reads" (groups listed, ungrouped null, names sanitized)
- [ ] 1.2 `write_create_account`, `write_update_account` and `write_reopen_account` in `packages/mcp/src/tools/write/accounts.ts`, scope `structure:write` (design D1, D4, D5): strict schemas, field-by-field call to the engine, `warnings` on a duplicate name. Failing tests first for every scenario of "Account maintenance tools", including extra keys refused with `closed` and `offbudget` unchanged on read-back, and a check that the result matches the app's own `account-create` and `account-update` on the same budget
- [ ] 1.3 `write_create_account_group`, `write_update_account_group` and `write_delete_account_group` (design D3). Failing tests first for every scenario of "Account group tools", including the dry run and the scope refusal
- [ ] 1.4 `write_close_account` and `write_delete_account` (design D3, D8): scopes per D2, destructive annotation, all validation before the audit line and the engine call, counts and ids in `entry.changes`, `allow_reconciled`, `requireRows` counted from `v_transactions` (a test that split children count toward the cap), read-back that fails the outcome if the account remains, bank-sync note in the description, dry run and audit line. Failing tests first for every scenario of "Account close and delete", including a refused close that does not unlink, an account really gone after delete, stale `confirm` for close, delete and group delete, and the transfer's other side losing its payee
- [ ] 1.5 `write_set_account_business_days` (design D6), scopes `structure:write` + `schedules:write`: deposit-only counting, refusal over a missing schedule or a skip that names `allow_regenerate`, the flag (default false) with its audit fields, the in-handler `delete` check when it would recreate a schedule, per-paycheck dates in result and entry. Failing tests first for every scenario of "Account business days tool", comparing paycheck deposit dates with the app's `account-set-business-days` result
- [ ] 1.6 Verify the server's registration test fails for a tool without a scope and passes for the eleven new tools, and that the `delete` tools are annotated destructive in the listing

## 2. Coverage, docs and checks (sc-4478)

- [ ] 2.1 Update `packages/mcp/coverage.json`: replace the two business-days skips with `write_set_account_business_days` and add the account and group handler and method lines. Verify `yarn check:mcp-coverage` fails before and passes after
- [ ] 2.2 Update the tool descriptions and `packages/mcp/README.md` (write and read tool tables, the deletes note that now lists account close and delete, the bank-sync unlink, what is not editable: opening balance, off-budget flag, account order). Verify each README rule matches a spec scenario
- [ ] 2.3 Add a fork news or release note line for the new MCP account tools, and run `yarn generate:fork-news` if the release story needs it
- [ ] 2.4 Run `yarn typecheck`, `yarn lint`, `yarn test` for `@actual-app/mcp`, and `yarn check:mcp-coverage`; all pass

## Workflow follow-up

- Account order and position is sc-4653. The Product Owner files the story for standalone bank-sync link and unlink. Other Non-Goals are other stories already.
