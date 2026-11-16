# Design

## Context

Verified on `origin/development` and in the Explore of sc-4215 (comment 4690):

- Every write goes through `loggedWrite` (`packages/mcp/src/tools/write/shared.ts`): an attempt line, the write, an outcome line, sharing a `call_id`. Lines carry `user_id`, `subject`, scopes and ids; update lines hold per-field before and after; create lines hold the created values and the outcome holds the new ids.
- The API path runs handlers with `undoDisabled: true`, so MCP writes never reach the engine's undo stack, which is in memory, 20 deep, last-in-first-out and lost on deploy. The audit log is on `/data` and survives.
- Scopes are a closed list in `packages/mcp/src/grants.ts`; a connection's grant comes from the grants file (hosted) or the environment (stdio).

## Goals / Non-Goals

**Goals:** undo any one earlier write of the A tools by id, safely; find write ids after context loss; stop `delete` being the only way to grant account deletes.

**Non-Goals:** the engine undo stack; undoing other identities' writes; moves, skip and deletes (sc-4691, sc-4692); a tool allow or deny list.

## Decisions

### D1. Replay the audit line, with conflict detection

`write_undo` reads the original attempt and outcome lines for `write_id` and reverses exactly the rows in the outcome's `applied` and `created`. Rejected: the engine undo. MCP writes never reach it, it is last-in-first-out, and a restart loses it, so it cannot undo write 3 without write 4, which is the 2026-11-13 case.

### D2. Scopes, owner, once

- **Scopes:** the tool is registered with `budget:read`. After reading the original lines it checks in the handler that the effective grant holds the scopes of the reversed tool (the precedent is `allow_regenerate` in sc-4478 D6: the scopes a call needs depend on data). A miss is the fixed scope refusal and a `refused` line. **This differs from the Explore, which also asked for `delete` to undo a create.** Undoing a create can only remove a row the same identity created and that is unchanged since, which is narrower than a delete; requiring `delete` would force the grant that sc-4541 withholds until undo exists. Reviewers may overturn this.
- **Own writes:** the line's `user_id` must equal the caller's. Another identity's write is refused with the same text as an unknown id, so ids cannot be probed.
- **Once:** a `write_undo` line with `undoes: <call_id>` and any outcome but a refusal marks the original used; a second request is refused, naming the undo's own `write_id`. Undoing an undo is not offered; the user reverses it by hand or asks for the original change again.

### D3. Conflict check, then apply

1. Read the current rows through the read-back code the writes already use.
2. For each logged field of each row, the current value must equal the audit `after`. A created row must exist with its logged fields unchanged and, for a category or group, be unused (the same notion of "in use" as category delete). Fields the write did not touch are not compared, so a bank sync that edits other columns does not block.
3. Any mismatch refuses the whole undo before the first change, with fixed text naming row ids and field names (never values or budget names), "Nothing changed", and saying the user can review and undo by hand.
4. Otherwise apply row by row like `write_update_transactions` (the API is not row-transactional). An engine failure midway writes an outcome line with `applied` and `failed`, the result says so, and the original stays marked used. The check and the apply run under one in-process lock shared with the write tools, so they cannot interleave on the single long-lived process.
5. The row cap applies to the undo as to the write. A row that was reconciled when written needs `allow_reconciled` to be undone. A transfer pair or a split created or edited by the write is not undoable in A (the partner's changes are not in the line); `list_writes` says why.

### D4. What is undoable

| Write | Undo |
| --- | --- |
| `write_update_transactions` (category, payee, notes, amount, date, account, cleared) | update the fields back |
| `write_create_transactions` | delete the created rows |
| `write_set_budget_amount` | set the month's amount back |
| `write_update_category`, `write_update_category_group` | update name, hidden and group back |
| `write_create_category`, `write_create_category_group` | delete, only while unused |

Everything else (`write_move_*`, `write_skip_paycheck`, `write_move_on_budget`, deletes, account tools) and any line without `schema: 2` is refused with fixed text "not undoable", and `list_writes` shows `undoable: false` with the reason.

### D5. Audit schema 2 and results

- Attempt lines gain `schema: 2`; for the A tools the line holds the before and after of every field the undo needs (a create's after is every field written). Outcome lines are unchanged. `undoes` is new on `write_undo` lines. The log stays append-only JSON, mode 0600; older lines stay valid and are read as v1.
- `write_id` is added to every write result by `loggedWrite`, not per tool, so a later write tool cannot forget it. The parity stories add the rule that each new write tool says whether it is undoable.
- `list_writes` reads the audit file's tail (at most the last 2 MB), keeps the caller's lines, joins attempt, outcome and undo lines, and returns the newest first: 20 by default, 50 at most. Tool names and reasons are fixed text; no budget values appear.

### D6. A narrower scope for account deletes (sc-4695)

**Problem.** `delete` is one scope. sc-4695 grants account close and delete (Ken, 2026-11-16), while sc-4541 withholds transaction, category and group deletes until undo C ships. A grant of `delete` cannot do both.

**Options.**

- **A per-grant tool deny or allow list.** As a deny list it fails open: every future deleting tool is allowed until someone adds it. As an allow list it is verbose and breaks "every tool is listed whatever the grant". Either way it adds a grants-file field, a stdio environment form and fingerprint handling.
- **A narrower scope (chosen).** One name in the closed `SCOPES` list. It fails closed (a future deleting tool keeps `delete`), needs no schema change (`scopes` already takes known names), works the same on stdio, and audit lines already record the effective scopes, so the log shows which was granted. The `*` client rule needs no change (read-only).

**Rule.** `accounts:delete` is the delete scope of the account area. `write_close_account`, `write_delete_account` and `write_delete_account_group` need `structure:write` and `accounts:delete` (and `write_delete_account` also `transactions:write`); they no longer need `delete`. The two scopes are independent: `delete` does not imply `accounts:delete`, so an existing grant with `delete` loses nothing it has now and gains no account deletes, the safe direction.

**sc-4478.** That change (an unmerged PR) names `delete` for the three tools in its proposal, D2 and D3. Its PR swaps `delete` for `accounts:delete` there. The recreate-a-schedule check in its D6 stays `delete` (a schedule delete is not an account delete). This change does not edit sc-4478's files.

## Risks / Trade-offs

- **Replaying a log line writes data from a file.** Mitigations: the file is 0600 and append-only; lines hold ids and values only; the owner check; the conflict check against current values; refusal text with ids and field names only.
- **A bank sync may change an undone field** and refuse the undo. That is intended: undo never overwrites a newer change; the user reviews by hand.
- **A partial undo** (engine failure midway) leaves a mixed state. It is logged with `applied` and `failed`; the original stays used, so the user finishes by hand.
- **`list_writes` reads up to 2 MB per call.** Acceptable for the single-process server; revisit if the log is rotated.
- **Two scopes mean two grant edits** for a user who wants both. That is the point.
