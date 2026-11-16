# Proposal

## Why

Story sc-4215 (Undo A, part of sc-4203): every MCP write is audit-logged with before and after values, but nothing replays one backwards. On 2026-11-13 the assistant moved 23 transactions into temporary categories and had to re-send every old value by hand. Ken wants undo before `delete` joins the production grant (sc-4541). This change is part A of three: transaction create and update, budget amounts, and category and group create and update. Audit gaps, category moves and paycheck skip are sc-4691 (B); snapshot and restore for deletes are sc-4692 (C).

Story sc-4695 (account close and delete in the production grant; Ken decided on 2026-11-16 they may ship without undo, behind `confirm_destructive`) exposed a flaw: `delete` is one scope, so a grant that allows account close and delete would also allow the transaction, category and group deletes, which must wait for undo C. The small, sound fix is a narrower scope, `accounts:delete`, so the grant can hold it without `delete`. It is the second, small group of this change.

## What Changes

- **`write_id` in every write result**: the audit `call_id` of the call, so an agent can name the write it wants undone.
- **`list_writes`** (`budget:read`): the caller's own recent writes (id, time, tool, rows, status, whether undone, whether undoable and why not), so a write can be found after the agent loses context.
- **`write_undo { write_id }`**: replays the audit line's before values with a per-field conflict check, for `write_create_transactions`, `write_update_transactions`, `write_set_budget_amount` and the category and group create and update tools. Not the engine's undo stack (design D1).
  - needs the scopes of the write it reverses, checked in the handler; no new permission;
  - the caller's own writes only; the whole undo is refused, changing nothing, if any logged field no longer holds the value the write left; applied once; every row verified before the first change; its own audit line with `undoes`.
- **Audit schema 2**: attempt lines carry `schema: 2` and the full before and after the A tools need; older lines are recognized as not undoable instead of guessed at.
- **A new scope `accounts:delete`** (sc-4695): the delete scope of the account area. The sc-4478 tools account close, account delete and account group delete then need `structure:write` and `accounts:delete` instead of `delete`. `delete` keeps its meaning for transactions, categories and category groups. Existing grants are unchanged.

Mobile scope: none. The MCP server has no UI, so this change is exempt from the desktop and mobile rule.

Not in this change: undo of category and group moves, paycheck skip and `write_move_on_budget` (sc-4691; the last is never undoable); undo of deletes (sc-4692); undo of account tools (not undoable, bank-sync unlink included; sc-4478 says so); a per-grant tool allow or deny list (design D6, rejected); editing the sc-4478 change itself (its PR swaps `delete` for `accounts:delete`, design D6); the hosting grant changes (sc-4695 and sc-4541 themselves).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: new requirements "Writes return their id", "List my writes", "Undo a write", "Undo annotations and confirm", "Writes are serialized", "Undo refuses on any conflict", "Undo reads current state", "What undo reverses", "An undo is used once it applied", "Undo reads the audit log safely" and "Account deletes have their own scope"; "Every tool declares a scope" and "Write audit log" are modified.

## Impact

- **Code:** `packages/mcp/src/audit.ts` (schema 2, `undoes`), `packages/mcp/src/tools/write/shared.ts` (`write_id`), a new `packages/mcp/src/tools/write/undo.ts` with `list_writes`, `packages/mcp/src/grants.ts` (one scope name), their tests, `packages/mcp/coverage.json` and `packages/mcp/README.md`. No `loot-core` or `@actual-app/api` change: undo uses the existing update, delete and set-budget methods.
- **Reviews:** Tester; Solution Architect; Security Analyst (multi-row writes by id, owner check, replay from a log line); the Product Owner reviews intent.
- **Ordering:** sc-4478's PR must use `accounts:delete` (design D6); sc-4695's hosting PR then grants `accounts:delete`, not `delete`.

## Decisions for Ken

None. The choices in the design (D2: undoing a create does not need `delete`; D6: the narrower scope) are Architect decisions and can be overturned in review.
