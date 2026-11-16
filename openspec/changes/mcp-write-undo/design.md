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

### D2. Checks, scopes, owner, once

Order (one fixed refusal text for every failure of step 1, so ids cannot be probed):

1. **Unknown, owner, schema, tool, outcome.** The write exists in the tail; its `subject` and `user_id` both equal the caller's (`user_id` is `unknown` when the sync server gave none, so `unknown` never matches without `subject`, and grants are keyed by `subject`); it has `schema: 2`; its tool is in D4's table; its outcome is clean. Not undoable: a `write_undo` line (no undoing an undo; the user reverses it by hand or asks for the change again), `applied: null`, `read_back: 'failed'`, no outcome line (a crash or `audit_outcome: 'not-logged'`), or `status: failed` with rows not in `applied`.
2. **Scopes, only for the caller's own write.** The tool is registered with `budget:read` plus the handler check (the precedent is `allow_regenerate` in sc-4478 D6). The reversed tool's scopes come from a code table keyed by tool name, never from the line's `scopes` (those are what the writer held). A miss is the fixed scope refusal and a `refused` line. **This differs from the Explore, which also asked for `delete` to undo a create.** Undoing a create can only remove a row the same identity created, unchanged and unused since, which is narrower than a delete; requiring `delete` would force the grant sc-4541 withholds until undo exists. Reviewers may overturn this.
3. **Annotations and confirm.** `write_undo` has its own `Access` object, not the shared `READ` (the server derives `readOnlyHint` from `access === READ`), annotated `readOnlyHint: false`, `destructiveHint: true`, with a test asserting both. Under `confirm_destructive`, undoing a create goes through the dry run and `confirm` path (it deletes); undoing an update needs none, since it restores values the caller wrote. Shared dry-run code takes a per-call flag rather than the tool's registered `destructive`.
4. **Once.** A write is used when a `write_undo` line with `undoes: <call_id>` has outcome `ok` or at least one row applied. A refusal, a conflict, or a failure before the first row does not use it, so the undo can be retried after the user resolves the conflict. A second request names the undo's own `write_id`.

### D3. Conflict check, then apply

1. Read the current rows through the read-back code the writes already use.
2. For each logged field of each row, the current value must equal the audit `after`. A created row must exist with its logged fields unchanged and be unused: a category is in use if any transaction, budget amount, rule or schedule refers to it, a group if it has any category (so a category moved into the group blocks the undo, and it never deletes categories). Untouched fields are not compared, so a bank sync editing other columns does not block.
3. Any mismatch refuses the whole undo before the first change, with fixed text naming row ids and field names (never values or budget names), "Nothing changed", and saying the user can review and undo by hand.
4. Otherwise apply row by row like `write_update_transactions` (the API is not row-transactional). An engine failure midway writes an outcome line with `applied` and `failed`, and the original is used (D2).
5. **Lock.** The tools read their before values before `loggedWrite`, so a lock inside `loggedWrite` is too late: W1 reads X, W2 sets Y, W1 sets Z and logs before X, and an undo of W1 would pass and wipe Y. The lock is taken once in the tool wrapper in `server.ts`, for every write tool and `write_undo`, and spans the before-read, the attempt line and the write (the check and apply for undo).
6. **Current state.** The row cap applies. Reconciled, transfer and split state are read from the row at undo time: a since-reconciled row needs `allow_reconciled` (for an update-undo and a create-undo delete alike); a row that is now a transfer pair, a split parent or a split child is refused as not undoable in A.
7. **Replay is allowlisted.** Only the per-tool allowlist of fields (D4's table) and only ids in `applied` and `created` are replayed, so a damaged line cannot widen what undo touches.

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
- `list_writes` and `write_undo` read the audit file's tail, at most the last 2 MB per call (a read-only `*` client may call `list_writes` freely, so the cap is the limit; no other cache). They drop the cut first line and any unparseable line, and treat a missing partner line as an unknown id. A write older than the tail gets the unknown-id refusal. Trust in the file equals trust in `/data` (0600, process-owned), which is acceptable; the conflict check, not the used marker, is the real guard (a restore of an older `/data` loses markers). `list_writes` keeps the caller's lines, joins attempt, outcome and undo lines, and returns the newest first: 20 by default, 50 at most. Tool names and reasons are fixed text; no budget values appear.

### D6. A narrower scope for account deletes (sc-4695)

**Problem.** `delete` is one scope. sc-4695 grants account close and delete (Ken, 2026-11-16), while sc-4541 withholds transaction, category and group deletes until undo C ships. A grant of `delete` cannot do both.

**Options.**

- **A per-grant tool deny or allow list.** As a deny list it fails open: every future deleting tool is allowed until someone adds it. As an allow list it is verbose and breaks "every tool is listed whatever the grant". Either way it adds a grants-file field, a stdio environment form and fingerprint handling.
- **A narrower scope (chosen).** One name in the closed `SCOPES` list. It fails closed (a future deleting tool keeps `delete`), needs no schema change (`scopes` already takes known names), works the same on stdio, and audit lines already record the effective scopes, so the log shows which was granted. The `*` client rule needs no change (read-only).

**Guard.** A test asserts every tool annotated destructive needs `delete` or `accounts:delete`, so a later account tool cannot be destructive under `structure:write` alone.

**Rollout.** A grants file containing `accounts:delete` read by a server image without it is invalid, and every connection falls back to `budget:read` (closed, but an outage). The sc-4695 hosting PR must merge after the image that knows the scope ships. The stdio default (`scopes` unset means every scope) also gains `accounts:delete` when the account tools merge; the README says so.

**Rule.** `accounts:delete` is the delete scope of the account area. `write_close_account`, `write_delete_account` and `write_delete_account_group` need `structure:write` and `accounts:delete` (and `write_delete_account` also `transactions:write`); they no longer need `delete`. The two scopes are independent: `delete` does not imply `accounts:delete`, so an existing grant with `delete` loses nothing it has now and gains no account deletes, the safe direction.

**sc-4478.** That change (an unmerged PR) names `delete` for the three tools in its proposal, D2 and D3. Its PR swaps `delete` for `accounts:delete` there. The recreate-a-schedule check in its D6 stays `delete` (a schedule delete is not an account delete). This change does not edit sc-4478's files.

## Risks / Trade-offs

- **Replaying a log line writes data from a file.** Mitigations: the file is 0600 and append-only; lines hold ids and values only; the owner check; the conflict check against current values; refusal text with ids and field names only.
- **A bank sync may change an undone field** and refuse the undo. That is intended: undo never overwrites a newer change; the user reviews by hand.
- **A partial undo** (engine failure midway) leaves a mixed state. It is logged with `applied` and `failed`; the original stays used, so the user finishes by hand.
- **`list_writes` reads up to 2 MB per call.** Acceptable for the single-process server; revisit if the log is rotated.
- **Once across processes.** Two replicas on `/data`, or a deploy overlap, could pass the same check. An update-undo is idempotent and the second create-undo delete fails, so no data is lost, but "once" would be false. Not planned for A (one process in production); the cheap fix is to append the attempt line, re-read the tail and proceed only if yours is the first undo attempt for that id. Backlog story filed by the Product Owner only if it becomes real.
- **Two scopes mean two grant edits** for a user who wants both. That is the point.
