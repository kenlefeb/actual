# Design

Facts read on origin/development (B1 merged): `packages/loot-core/src/server/native/reconcile.ts` (`reconcileMonth`, `reconcileRows`, `reconcileTick`, `reconcileListSet`, `summaryOf`), `accounts/statement-balance.ts` (the record, `clearedBalanceOf`, consume), the web `reconciliation.ts` (`lockTransactions`, `createReconciliationTransaction`), the MCP's selection in `packages/mcp/src/tools/read/reconciliation.ts` and its lock in `tools/write/reconcile.ts`, the Swift `Reconcile.swift`, `ReconcileViewModels.swift` and `NativeReconcileViewController.swift`, the Figma frames 54:269 to 54:487.

## D1. One lock selection in loot-core

Today three places decide what a reconcile locks: the web client, the MCP and (for B1) nothing. B2 puts the selection in loot-core once, `lockPlan(accountId)` in `server/accounts/reconcile-plan.ts`: rows of the account that are cleared, not reconciled and not split children; every child of a selected split parent; the transfer partner ids of those rows (listed, never written); children whose parent is already reconciled named as skipped. The native lock and its preview use it. A contract test builds one fixture (splits, a reconciled parent with an unreconciled child, transfers, an uncleared row) and asserts that this set equals the MCP's `reconciliation()` and the web `lockTransactions` selection, so the three cannot drift. Moving the MCP onto `lockPlan` needs a fork handler and is Backlog.

## D2. Step 3, resolve

`native/reconcile-matches {account_id}` returns, for a difference d not zero, at most the results limit of matches, each `{kind, row ids, amounts}`: `tick-one` (an uncleared, unreconciled, non-child row up to today with amount d), `tick-two` (two such rows summing to d, found with a hash map in linear time), `untick-one` (a cleared, unreconciled row with amount -d). Order: single before pair before untick, then nearest date first. Candidates are capped at the candidates limit (the most recent rows). Swift shows them and does no arithmetic.

Search is `native/reconcile-rows` with a new `search` argument: a number matches rows by amount and by the digit-swapped amounts (two adjacent digits swapped, as the frame's "also finds $41.08 and $48.10"), text matches payee and notes, case-insensitive. The row and summary shapes are B1's.

"Add the missing transaction": the existing mobile add form at `/transactions/new` with the account and the difference filled in. That form reads `account`, `category` and `payee` query parameters by name but has **no `amount` parameter**, so the web form gains one (integer cents). The native flow closes to the checklist (the account reads In progress); the person adds the row, returns, and the flow re-reads on the change events.

The adjustment is last and never automatic (D4).

## D3. Step 4, lock

`native/reconcile-lock-preview {account_id}` returns the rows to lock (up to the list limit, then a count with `truncated: true`), the linked transfer partners (id, account, amount, date, not locked), skipped children, the counts, the record's amount, source and entered-at, and a `plan_digest` over every row, partner and balance involved, not only the listed ones.

**The Figma step 4 says transfer partner legs "lock too" and counts 17 + 2 = "Lock 19". That contradicts the app and the MCP, which lock only this account's rows; the partner leg is only frozen (the existing rule asks before editing a transfer whose other side is reconciled).** Locking partner rows would change two accounts at once and breaks the story's "the app's own lock behaviour". B2 follows the app: the button reads "Lock 17 transactions" and the partners are listed under "Linked transfers in other accounts (not locked)". The UX Designer updates frame 54:406 and its notes. The unlock note stays: locked rows unlock only in the app (a row's Unlock), never through an assistant.

## D4. The adjustment

`native/reconcile-adjust {account_id, amount, category_id?, label, undoToken}` is a person's action: it requires a usable record, requires `amount` to equal the live difference (a stale sheet fails and changes nothing), and creates one transaction as the app's `createReconciliationTransaction` does: cleared, unreconciled, date today (the app's `currentDay()`; the frame's Nov 30 is the period end and the Designer confirms), `notes` = the localized label the app passes (at most 100 characters), no payee, then the rules run; an explicit `category_id` (an existing category, never on an off-budget account) wins over a rule's. One undo step with the token. No `api/` handler and no MCP tool creates an adjustment: the MCP's reconcile tool never does, and a normal `write_create_transactions` row is not an adjustment. The sheet is a medium-detent sheet with the amount in its button ("Add +$41.80 adjustment") and the line on what happens to the budget. After it, the difference is zero and step 4 lists the adjustment, which can be removed before locking with `native/undo` and its token while it is still the last undoable write; otherwise the sheet says to delete it in the register.

## D5. The lock

`native/reconcile-lock {account_id, plan_digest}`, a mutator that is **not undoable** (an undo would unlock rows from the bridge and revive the consumed record; unlocking stays the app's per-row action):

1. Require a record that is unconsumed and unexpired and a zero difference. Source `cleared` is allowed: it is the person's own reconcile, as on the web, and only the assistant refuses that source (sc-4800).
2. Recompute `lockPlan` and require its digest to equal `plan_digest`, else refuse: "The account changed since this screen. Review it again. Nothing changed."
3. One `batchUpdateTransactions` sets `reconciled` on the rows (children follow parents).
4. Re-read the cleared balance. **Consume the record whenever rows were locked**, matching the MCP rule, including when the re-read no longer matches. Stamp `last_reconciled` only when the balance is verified; a zero-row lock stamps and consumes when verified.
5. Return `{locked_ids, linked_ids, verified, cleared, difference}`. An unverified result says the rows are locked, the balance moved while locking, and to review.

The page supplies no balance and no row list; the record and loot-core decide.

## D6. Done and the checklist

Done follows `last_reconciled` (this month), which the lock stamps, so the checklist needs no new status. The done screen shows the account name, the statement balance and the locked count, a success haptic and a VoiceOver announcement, no confetti, and offers the next due account or the checklist; ✕ returns to wherever the flow began. B1's "finish in the register" exit is replaced by Continue to step 4 at 0.00; "Done for now" stays above zero.

## D7. Limits are settings

Synced preferences, parsed with `^\d+$`, zero or above-ceiling values ignored and the default used, as B1's: `reconcile-match-max-candidates` (300, ceiling 2,000), `reconcile-match-max-results` (5, ceiling 20), `reconcile-lock-list-max-rows` (200, ceiling 2,000). The list limit cuts only what the preview lists: the digest covers every row and the button's count is exact. No limit on how many rows a person may lock (a human action in the app, as on the web).

## D8. Archiving next to `native-reconcile-flow`

That change is merged in code but not archived, so its requirements (including "Step 2 ticks rows against a live difference", whose exit this change replaces) are not in the main spec and cannot be MODIFIED. Here the new requirement "Step 2 continues to the lock" states the replacement; at archive, fold the "Ready to lock — finish in the register" wording out of the older requirement. No requirement header collides.

## D9. Security notes

- New bridge writes: `native/reconcile-adjust` and `native/reconcile-lock`, allowlisted on the Swift and page sides; neither is under `api/`, so no script or MCP tool reaches them (a test pins that). The existing origin checks and undo-token rules apply.
- A compromised page could call them, as it could any native write; they take no balance and, for the lock, only a digest; the adjustment amount is re-checked against the live difference.
- The lock cannot be replayed: the record is consumed, and the digest binds the shown rows.
- Transfers: partner legs are never written by the lock.

## Risks

- The pair search is linear, but the candidates cap keeps it cheap on a large account; if the cap hides the match, search still finds it.
- An unverified lock leaves rows locked and the record consumed; the person re-enters the balance after unlocking in the app if needed.

## Decisions for Ken

None. The two Figma corrections (partner legs not locked, adjustment date) are the Designer's to apply.
