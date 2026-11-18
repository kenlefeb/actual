# Tasks

## 1. Undo of category and group moves (sc-4691)

- [ ] 1.1 Failing tests first for "Moves log their old place": a category moved from the middle, from the end and within its group; a group moved from the end and from the middle; new lines hold `next_category_id` or `next_group_id` and no `before_category_id` or `before_group_id`
- [ ] 1.2 `write_move_category` and `write_move_category_group` in `packages/mcp/src/tools/write/categories.ts` log the old next sibling read under the write lock (design D1)
- [ ] 1.3 Failing tests first for every scenario of "Undo of a move", "Undo of a move refuses on any conflict" and the modified "What undo reverses": undo of each move kind, missing `structure:write`, old neighbour gone, old group gone, moved again, reordered on another device (sync first), name clash, a schema 2 move line without the new field, a logged value that is not an id, a refused undo retried after the conflict is fixed
- [ ] 1.4 Planners for `write_move_category` and `write_move_category_group` in `packages/mcp/src/tools/write/undo.ts`, their `structure:write` entries in `UNDOABLE`, sync first, the checks of design D3, one engine call, and 1 row against the row limit (design D2, D3)
- [ ] 1.5 Run `yarn typecheck`, `yarn lint` and the `@actual-app/mcp` tests; all pass

## 2. Declared not-undoable list, undo-line check and always confirm (sc-4691)

- [ ] 2.1 Failing tests first for "Every write declares whether it is undoable" and the modified "List my writes" and "Undo a write": a test that lists every registered write tool and fails unless it is in exactly one table and its description ends to match; reasons in `list_writes`; the caller's own declared write refused with its reason; another identity's write still refused with the one unknown text and no reason
- [ ] 2.2 `NOT_UNDOABLE` with the reasons of design D4 in `undo.ts`; `whyNot` and the `write_undo` refusal order use it; every write tool's description ends with "write_undo reverses it." or "Not undoable: <reason>."; the `write_undo` description lists moves
- [ ] 2.3 Failing tests first for the modified "One write cannot fill the audit tail" (an update and a create whose undo line would not fit), then `requireUndoableLine` for every tool in `UNDOABLE` (design D5)
- [ ] 2.4 Failing tests first for "Permanent actions always confirm" (confirm off: bank-linked close and delete, unlinked close, templates), then `alwaysConfirm` on `write_apply_budget_templates` and on bank-linked close and delete in `account-close.ts` (design D6)
- [ ] 2.5 `packages/mcp/README.md`: the undo section lists moves and the not-undoable reasons; the confirm section names the always-confirm tools
- [ ] 2.6 Run `yarn typecheck`, `yarn lint`, `yarn check:mcp-coverage` and the `@actual-app/mcp` tests; all pass
