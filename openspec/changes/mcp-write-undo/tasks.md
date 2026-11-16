# Tasks

## 1. Write ids, list_writes and write_undo (sc-4215)

- [ ] 1.1 Audit schema 2 in `packages/mcp/src/audit.ts` and `shared.ts` (design D5): `schema: 2` on attempt lines, `undoes` on undo lines, full before and after for the A tools. Failing tests first: a v1 line is recognized as not undoable; no secret in any line
- [ ] 1.2 `write_id` on every write result in `loggedWrite`. Failing tests first for "Writes return their id", across every existing write tool
- [ ] 1.3 `list_writes` (`budget:read`). Failing tests first for every scenario of "List my writes", including another identity's lines never listed and the 2 MB tail bound
- [ ] 1.4 `write_undo` in `packages/mcp/src/tools/write/undo.ts`: transaction update first, then create, budget amount, category and group update, then create (design D2 to D4). Failing tests first for every scenario of "Undo a write" and "What undo reverses": the 23-move case undone in one call, a later edit refusing the whole undo with nothing changed, an edit of another field not refusing, a scope miss for the reversed tool, another identity's write, a second undo, an engine failure midway, a reconciled row without `allow_reconciled`, a used category refusing the undo of its create
- [ ] 1.5 Verify an undo and a write cannot interleave (a test running both concurrently) and that undo refusals write a `refused` line without budget data
- [ ] 1.6 Update `packages/mcp/coverage.json` for `write_undo` and `list_writes`, and `packages/mcp/README.md` (what is and is not undoable). `yarn check:mcp-coverage` fails before and passes after
- [ ] 1.7 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass

## 2. The accounts:delete scope (sc-4695)

- [ ] 2.1 Add `accounts:delete` to `SCOPES` in `packages/mcp/src/grants.ts` and to the scope tables in tests and README. Failing tests first for every scenario of "Account deletes have their own scope": the grants file accepts it, a `*` client with it is invalid, the stdio environment accepts it, `delete` alone does not allow an account delete, `accounts:delete` alone does not allow a category delete
- [ ] 2.2 When the sc-4478 tools merge, they use `accounts:delete` (its PR, design D6). If this change lands first the account tools do not exist yet, and this group covers the scope only
- [ ] 2.3 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass
