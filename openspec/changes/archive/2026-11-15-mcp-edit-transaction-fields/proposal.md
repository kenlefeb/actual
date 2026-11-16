# Proposal

## Why

Story sc-4204, part of the sc-4203 parity umbrella. `write_update_transactions` can change only category, payee and notes. On 2026-11-13 the assistant could not correct a wrong opening balance or Ken's paycheck split, so it added a correcting row instead, and Ken fixed both by hand. Under the permission model (sc-4477), editing a transaction's amount, date, account and cleared flag is ordinary `transactions:write` work. It should behave exactly as the same edit does in the app.

## What Changes

- **Four new fields, one existing tool.** `write_update_transactions` gains `amount`, `date`, `account_id` and `cleared`, plus a per-row `allow_reconciled` override. It stays one tool and keeps the `transactions:write` scope. A single-row edit is not destructive, so it needs no dry run; a grant can still turn confirm on.
- **One call, one engine batch.** The rows a call names are applied through a new fork API method, `updateTransactions`, built on loot-core's own `updateTransaction` and `transactions-batch-update`.
  - The named rows, split children included, change together or not at all, so a split's parent and children change together.
  - Transfer partners follow in a second step, as in the app. If that step fails, the result and the audit outcome report what was read back.
  - This replaces "stop at the first failure".
- **Splits stay consistent.**
  - After the call, every split it touches must have children that add up to the parent amount, or the whole call is refused. Ken's paycheck fix (parent total and child amounts edited together) is one call.
  - `date`, `account_id` and `cleared` are set on the split parent only. Children follow, as in the app.
- **Transfers stay paired, as in the app.**
  - Editing one side updates the other as the engine's transfer code does: the opposite amount, the edited side's notes and schedule, the transfer payee, and categories cleared per the on- and off-budget rules. Each side keeps its own date, as in the app.
  - Moving one side to the other side's own account is refused.
- **Reconciled rows need the override, as in the app.**
  - A change to amount, date, account or payee needs `allow_reconciled` when the row is reconciled, or when its transfer partner is. This is the app's confirmation.
  - Changing the account un-reconciles the row. Setting `cleared` to false on a reconciled row also needs the override, and un-reconciles it. This is a deliberate departure from the app, which changes `cleared` without asking and offers "unlock" separately. The stricter rule never leaves a row reconciled but uncleared.
  - Behaviour change: payee edits on reconciled rows now need the override too, matching the app.
- **Other rules:**
  - Schedule-linked rows keep their link, and the edit doesn't change the schedule. Paycheck definitions are sc-4208.
  - A row a moved account counts as moved history keeps the existing "no category" rule, now checked on the row as it will be after the edit.
  - Moving a row to an off-budget account clears its category, as the engine does.
  - A closed account is refused as a target.
- **Audit and result.** The attempt line lists every field the call changes, including the transfer partner's amount, payee, notes, schedule and category, and a category cleared by an off-budget move. The result reads back every affected row, with before and after values. The row cap counts the rows named in the call, as today.

Mobile scope: none. The MCP server and the API have no UI, so this change is exempt from the desktop and mobile rule.

Not in this change: creating or removing splits (sc-4212), linking transfers or schedules (sc-4205, sc-4206), deleting (sc-4485) and reconciling (sc-4213).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`:
  - "Write tools": `write_update_transactions` lists its new fields.
  - "Multi-row updates stop at the first failure" is renamed "Multi-row updates apply together": the named rows together, and transfer partners in a second step.
  - New requirements: transaction field edits, splits, transfers, reconciled rows, moved history after the edit, and the audit of cascaded changes.
- `api-transaction-mutations`: adds a multi-transaction update whose named rows apply together, with transfer partners following as for a single update.
- `api-fork-handlers`: the list of fork handlers grows from 17 to 18, to include `updateTransactions`.

## Impact

- **Code:**
  - `packages/loot-core/src/server/api.ts`: new `api/transactions-update` handler, reusing `updateTransaction` and `transactions-batch-update`.
  - `packages/api/methods.ts` and its test: `updateTransactions`, and the fork-handler list.
  - `packages/mcp/src/tools/write/transactions.ts` and its tests.
  - `packages/mcp/coverage.json`, and the MCP README.
- **Ordering:** `mcp-permission-scopes` is archived first (PR #374), because both modify "Write tools" in `mcp-server` and this delta is written against its text.
- **Reviews:** Tester; Solution Architect (`loot-core` and the public API); Security Analyst is not required (no auth, secrets or sync change). The Product Owner reviews intent.
