# Design

## Context

See proposal.md for the motivation and the specs for the requirements. What the code does today:

- **`write_update_transactions`** (`packages/mcp/src/tools/write/transactions.ts`):
  - Validates ids, builds `{ ids, changes }` for the audit line, then calls `api.updateTransaction(id, fields)` row by row and stops at the first failure.
  - The scope is `transactions:write`. The row cap comes from `requireRows` (the grant's `max_rows`, at most 50).
- **`api.updateTransaction`** goes to `api/transaction-update` (`loot-core/src/server/api.ts`):
  1. Loads the transaction's whole split (`splits: 'grouped'`) and ungroups it.
  2. Applies `shared/transactions.ts` `updateTransaction`, which, for a split, re-makes every child from the parent (`makeChild` copies account, date, cleared and reconciled) and sets `error` when the children don't add up.
  3. Sends the diff to `transactions-batch-update`.
- **`transactions-batch-update`** (`server/transactions/index.ts`):
  - Writes the diff inside `batchMessages`.
  - Clears the category on a parent or on a row in an off-budget account.
  - Runs `transfer.onUpdate`, which gives the other side the opposite amount and the same date, moves it, or removes the transfer. That is the app's own path.
- **The app's edit rules** (`desktop-client`, `TransactionsTable.tsx`):
  - A change to amount, payee, account or date on a reconciled row, or on a row whose transfer partner is reconciled, asks for confirmation (`confirm-transaction-edit`).
  - Changing the account sets `reconciled` false.
  - Setting `cleared` on a reconciled row offers "unlock", which sets `reconciled` false.
  - Moving to an off-budget account clears the category.
  - Moved history asks for confirmation only when categorizing.

## Goals / Non-Goals

**Goals:**
- The same result as the app's edit, by running the same loot-core code.
- A split's parent and children change in one write, never leaving a half-edited split.

**Non-Goals:**
- Turning a transaction into a split, or adding or removing children (sc-4212).
- Linking transfers (sc-4205) or schedules (sc-4206).
- Delete (sc-4485) and reconcile (sc-4213).
- Changing the definition behind a schedule or paycheck (sc-4207, sc-4208).

## Decisions

### D1. Extend `write_update_transactions`, not a new tool

New optional row fields: `amount` (number, checked by `requireAmount`), `date` (checked by `requireDate`), `account_id`, `cleared` (boolean) and `allow_reconciled` (boolean). The scope stays `transactions:write`, and the tool is not marked destructive (PO decision on sc-4204).

**Why:**
- In the app this is one edit form. One tool means one validator, one audit shape, and nothing for the agent to choose between.
- A split fix needs category and amount changes in the same atomic call, which a separate tool would split across two writes.

**Alternative considered:** a new `write_edit_transaction` for one row. Rejected: it can't fix a split (parent plus children) atomically, and it duplicates the id, reconciled and moved-history checks.

### D2. A fork API handler for one atomic batch: `api/transactions-update` / `updateTransactions`

The handler follows `api/transaction-update`, but for a list:
1. Load every named transaction's whole split (`splits: 'grouped'`), ungroup, and keep one working list.
2. For each `{ id, fields }` in order, apply `updateTransaction(working, { ...existing, ...fields })` and keep its `data` as the next working list. The changes then build on each other: a parent's new amount, then a child's.
3. Diff the final list against the original, and send that diff to `transactions-batch-update` once.

It is wrapped in `withMutation`, like the single update (`api-transaction-mutations`: complete before returning, failures reach the caller). An unknown id throws before anything is written.

The typed method `updateTransactions` goes in `packages/api/methods.ts`. The fork-handler list in the API test grows to 18, and the `coverage.json` line maps it to `write_update_transactions`.

**Why:** the app writes a split edit as one diff, so a single batch per call is the closest match. Calling `updateTransaction` once per row would leave the split unbalanced between the parent and child writes, and would sync that intermediate state.

**Alternatives considered:**
- MCP builds the diff itself and calls `transactions-batch-update` through `internal.send`. Rejected: that is an untyped call into internals, which `api-fork-handlers` exists to avoid.
- Upstream's `batchBudgetUpdates`-style start and end. Rejected: no such wrapper exists for transactions.

### D3. Validation in MCP before the audit line

Order inside the tool: row cap → unique ids → `requireIds` (transactions, categories, payees, the target account) → per-row checks → balanced splits → moved history after the edit → build `changes` → `loggedWrite` → `updateTransactions`.

**Per-row checks**, each a fixed-text `Refusal` that names the row id and never budget text:
- `date`, `account_id` or `cleared` on a child (`is_child`): "Set it on the split parent; its children follow."
- The target account is closed: "Reopen the account first."
- The target account is the transfer partner's account (the partner row's `account`): "A transfer can't move into its own other account."
- Reconciled:
  - The row has `reconciled` and the call changes `amount`, `date`, `account_id` or `payee_id`, or sets `cleared` false; or
  - the row has a `transfer_id` whose partner is reconciled and the call changes one of those four fields.
  - Without `allow_reconciled`, the call is refused: "Row … is reconciled; set allow_reconciled to change it."
  - With it, the tool also sends `reconciled: false` when the account changes or `cleared` becomes false, as `onUpdateAfterConfirm` does.

**Balanced splits:**
1. For each split touched (a named parent or child), take the parent amount and the children's amounts from the read rows.
2. Overlay the call's new amounts.
3. Refuse if the children's sum ≠ the parent amount: "Split … would be off by N cents."

This uses the same arithmetic as `recalculateSplit`, with no engine call, so a refusal writes nothing and no audit line.

**Moved history after the edit:** apply `isMovedHistory` to each row's after-state: its new account, date, and category (new or existing). This reuses the existing `refuseCategorizingMovedHistory`.

### D4. Predicting cascaded changes for the audit line

`changes` lists each named field's before and after, plus:
- **Transfer partner** (the row has a `transfer_id`, is not a parent, and amount or date changes): `amount` → minus the new amount, `date` → the new date, under the partner's id.
- **Category cleared:** when `account_id` moves the row to an off-budget account and it has a category, `category_id` → null. For a split parent, the children's categories are cleared too.
- **Split children** when a parent's date, account or cleared changes: each child's field.
- `allow_reconciled: true` is recorded as a change entry of its own, so the log shows the override.

**The result** reads back every id in `changes`, the named rows plus the cascaded ones, and reports before and after from the read-back, as the existing `updateResult` does for the old fields. If the read-back fails, the existing `read_back` note applies.

### D5. Outcome line and failure

The call is one batch, so the outcome is either `applied` = every named id or `applied` = [] with `failed` set to the call. "Multi-row updates stop at the first failure" is renamed and becomes all or nothing. `not_attempted` goes away. The engine's error still goes only to stderr (scrubbed).

## Risks / Trade-offs

- **The prediction can drift from what the engine does,** for example when an upstream change to transfer behaviour adds a cascade. Mitigation: the result is the read-back, not the prediction, and a test compares the predicted change set with the read-back for transfer, off-budget and split cases.
- **Payee edits on reconciled rows now need the override.** This changes what the assistant can do today. It is the app's rule, and the refusal text says how to proceed.
- **Batch atomicity is `batchMessages`, not a database transaction across post-processing.** Transfer updates run in a second `batchMessages` after the first, exactly as in the app's edit. This change keeps that and doesn't try to do better than the app.
- **Larger calls.** A 50-row call can cascade to about 100 rows (transfers) and to children. The row cap stays on named rows, as the spec says. The batch is one diff, so this costs little.

## Migration Plan

1. Archive `mcp-permission-scopes` first, because this delta's "Write tools" text is written against it.
2. Ship in one release. Clients see the new optional fields on the existing tool. The only behaviour change for existing calls is that payee edits on reconciled rows need `allow_reconciled`, and multi-row failures now apply nothing.
3. Rollback: the previous release, where the old fields still work.
