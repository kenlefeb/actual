# Tasks

## 1. Delete transactions (sc-4485)

- [x] 1.1 Failing tests first for "Delete transactions" and "Transaction delete refusals": transfer pair, split parent with children (delete-limit count), partner that is a split child (unlinked), attachments, split child refused, reconciled row, reconciled partner, a child's reconciled partner and a reconciled partner child refused without the override and allowed with it and the grant's option, unknown or deleted id, dry run and `confirm`, missing `delete` scope
- [x] 1.2 `write_delete_transactions` in `packages/mcp/src/tools/write/transactions.ts` (design D7), scopes `transactions:write delete`, annotated destructive, deleting through `api.deleteTransaction`
- [x] 1.3 `budget_id` on every schema 2 audit line and the `write_undo` refusal on a mismatch ("Audit lines name the budget"), failing tests first
- [x] 1.3a Its attempt line per "Deletes log what their undo needs" (design D3) and the size check of "A delete must be undoable", sizing the undo's line too (design D4), with failing tests first
- [x] 1.4 `packages/mcp/coverage.json`: `api/transaction-delete` and `deleteTransaction` point at `write_delete_transactions`; README tool table. `yarn check:mcp-coverage` passes
- [x] 1.5 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass

## 2. Undo of deletes (sc-4692)

- [ ] 2.1 Failing tests first for "Undelete rows", "Undelete sets only fixed columns" and "Undelete restores rows and cells together": a deleted transaction, split and category come back with their ids; a live, missing or other-budget row, a table outside the list, a column on a row not un-deleted in the call, a relink of a live row, a mapping to another category, all reject with nothing changed; a failure midway leaves rows and cells unchanged; `check` changes nothing; messages use the db columns `transferred_id` and `description`; no rule runs
- [ ] 2.2 Fork handler `undelete-rows` in `packages/loot-core/src/server/api.ts` with its types, and `undeleteRows` in `packages/api/methods.ts`; the API test's handler list grows by one (design D2); `coverage.json` line for the handler and method (tool `write_undo`)
- [ ] 2.3 Category and group delete attempt lines per "Deletes log what their undo needs" and the size check of "A delete must be undoable", with failing tests first (design D3, D4)
- [ ] 2.4 Undo planners in `packages/mcp/src/tools/write/undo.ts` for `write_delete_transactions`, `write_delete_category` and `write_delete_category_group`, and their scopes in the code table (design D1, D6). Sync first, check through `check`, apply in one call, read back (design D5). Failing tests first for every scenario of "Undo of a delete restores the original rows", "Undo of a delete reports what it sees", "Undo of a delete refuses on any conflict", "Undo of a transaction delete checks live references" and the modified "What undo reverses"
- [ ] 2.5 Tool descriptions: the delete tools no longer say "There is no undo"; `write_undo` lists deletes; README
- [ ] 2.6 Run `yarn typecheck`, `yarn lint`, `yarn check:mcp-coverage` and the `@actual-app/mcp`, `@actual-app/api` and `@actual-app/core` tests; all pass
