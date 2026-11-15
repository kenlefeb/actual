# Tasks

## 1. Batch update in loot-core and the API (sc-4204)

- [x] 1.1 Add `api/transactions-update` in `packages/loot-core/src/server/api.ts` per design D2 (grouped load, `updateTransaction` applied in order on one working list, one `transactions-batch-update`, `withMutation`). Write the failing tests first in `api.test.ts` for the scenarios of "Several transactions update as one batch" (split parent and child together, one bad id leaves everything unchanged, transfer follows and keeps its own date, a failure injected in the transfer step leaves the named side changed), then make them pass
- [x] 1.2 Add the typed `updateTransactions` method to `packages/api/methods.ts` and the handler to the fork-handler list in the API test (18 handlers). Verify the "Every fork handler has a method" test fails without the method and passes with it
- [x] 1.3 Add the `coverage.json` lines for `api/transactions-update` and `updateTransactions` → `write_update_transactions`; verify `yarn check:mcp-coverage` passes

## 2. New fields on `write_update_transactions` (sc-4204)

- [x] 2.1 Add `amount`, `date`, `account_id`, `cleared` and `allow_reconciled` to the row schema, with bounds through `requireAmount`/`requireDate` and the target account through `requireIds`; switch the write to one `api.updateTransactions` call, with the read-back outcome on failure per design D5. Failing tests first for "Transaction amount, date, account and cleared edits" (opening balance, move account, off-budget clears category, closed account refused, cleared) and "Multi-row updates apply together", including a failure injected in the transfer step that is reported as the named side applied and the partner not updated
- [x] 2.2 Split checks per design D3: refuse date/account/cleared on a child, and refuse an unbalanced split with the parent id and the cents difference. Failing tests first for every scenario of "Split edits keep the split balanced", including the paycheck split fixed in one call
- [x] 2.3 Transfer checks: refuse moving a side into its partner's account, and report the partner's before and after values (amount, payee, notes, schedule, category; never date). Failing tests first for every scenario of "Transfer edits keep the pair"
- [x] 2.4 Reconciled checks with `allow_reconciled` (amount, date, account, payee, cleared false; partner reconciled), sending `reconciled: false` when the account changes or the row is unlocked. Failing tests first for every scenario of "Reconciled rows need an explicit override"
- [x] 2.5 Moved history checked on the after-state and schedule links kept. Failing tests first for "Moved history is checked after the edit" and "Schedule-linked rows keep their link"
- [x] 2.6 Audit prediction and read-back per design D4: transfer partner, cleared category, split children and the `allow_reconciled` entry in `changes`; the result reads back every affected id. Failing tests first for "Cascaded changes are audited", plus a test that the predicted change set matches the read-back for the transfer amount, transfer account move, transfer notes edit, off-budget and split cases

## 3. Documentation and checks (sc-4204)

- [x] 3.1 Update the tool description and `packages/mcp/README.md` (new fields, split, transfer and reconciled rules, named rows applied together, transfer partners in a second step). Verify each rule in the README matches a spec scenario
- [x] 3.2 Add a fork news or release note line for the new MCP edit fields. Verify `yarn generate:fork-news` output if the release story needs it
- [x] 3.3 Run `yarn typecheck`, `yarn lint`, `yarn test` for `@actual-app/core`, `@actual-app/api` and `@actual-app/mcp`, and `yarn check:mcp-coverage`; all pass

## Workflow follow-up

- Archive `mcp-permission-scopes` before archiving this change.
