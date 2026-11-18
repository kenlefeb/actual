# Proposal

## Why

Story sc-4691 (Undo B, the second part of sc-4203 after sc-4215 and sc-4692). Agents can move categories and category groups but cannot undo a move, though Ken can undo one in the app. The Architect's Explore (sc-4691 comment 5088) found the reason: a move's audit line logs its old place as `null` every time, so nothing records where the row was. It also found that `list_writes` and `write_undo` give one generic reason, "not undoable yet", for every write outside the undo table, and that some tool descriptions say nothing about undo. The Product Owner's decisions are in comment 5099.

## What Changes

- **Moves log their old place**: `write_move_category` logs the category's old next sibling as `next_category_id` (null when it was last), and `write_move_category_group` logs `next_group_id`. These are new field names: the old `before_category_id` and `before_group_id` changes, always null in production lines, are never read as "was last".
- **`write_undo` reverses moves**: a category or group goes back before its old next sibling (or last). It syncs first, applies the move tool's own rules to the old place, accepts only a well-formed line, and refuses on any conflict (including an old neighbour that is gone) with a reason in plain words and what to do instead. It needs `structure:write` and changes nothing on refusal. Move lines without the new field are not undoable, with a fixed reason.
- **A declared not-undoable list**: every write tool is either in the undo table or in a not-undoable table with a fixed reason. `list_writes` and `write_undo` give that reason. Each write tool's description says whether `write_undo` reverses it. Budget templates stay not undoable.
- **Every undoable write fits its undo**: the up-front audit line check that deletes already have (their own line and their undo's line) applies to every undoable tool.
- **Always confirm two permanent actions**: closing or deleting a bank-linked account, and applying budget templates, always answer the first call with a dry run and a `confirm`, whatever `confirm_destructive` says.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

Not in this change:
- Undo of `write_skip_paycheck` (sc-5096). It needs a new fork loot-core handler (`paycheck-unskip`), an `api-fork-handlers` delta and its own Security review. It gets its own change, so this one can be archived when sc-4691 merges without waiting for a handler, and each change keeps one story and one PR. Until then the skip is on the not-undoable list.
- Undo of the account tools and budget carryover (sc-5097), and an MCP read of upcoming scheduled rows (sc-5098).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Moves log their old place", "Undo of a move", "Undo of a move refuses on any conflict", "Undo of a move applies the move's own rules", "Undo of a move reads only a well-formed line", "Bank-linked is read at each call", "Every write declares whether it is undoable" and "Permanent actions always confirm". Modified requirements: "What undo reverses", "Undo a write", "List my writes" and "One write cannot fill the audit tail".

## Impact

- **Code:** `packages/mcp/src/tools/write/categories.ts` (move audit lines), `undo.ts` (two planners, scope table, not-undoable table, reasons), `shared.ts` (the undo-line size check for every undoable tool), `budget.ts` and `account-close.ts` (always confirm), the descriptions of every write tool, tests, `packages/mcp/README.md`. No loot-core or API change.
- **Audit log:** stays `schema: 2`. See design D2.
- **Production:** 26.10.1-alpha.45 has every scope including `delete`, `confirm_destructive` on, `max_rows` 10 and no `allow_reconciled`. Because confirm is already on there, the always-confirm rule changes nothing in production. Move undo needs `structure:write`, which production has.
- **Reviews:** Tester; Solution Architect; Security Analyst (an undo that replays a logged id; the confirm rule); the Product Owner reviews intent.

## Decisions for Ken

None. The Product Owner decided the open questions in sc-4691 comment 5099.
