# Design

Facts read on origin/development (B1 merged): `packages/loot-core/src/server/native/reconcile.ts` (`reconcileMonth`, `reconcileRows`, `reconcileTick`, `reconcileListSet`, `summaryOf`), `accounts/statement-balance.ts` (the record, `clearedBalanceOf`, consume), the web `reconciliation.ts` (`lockTransactions`, `createReconciliationTransaction`), the MCP's selection in `packages/mcp/src/tools/read/reconciliation.ts` and its lock in `tools/write/reconcile.ts`, the Swift `Reconcile.swift`, `ReconcileViewModels.swift` and `NativeReconcileViewController.swift`, the Figma frames 54:269 to 54:487.

## D1. One lock selection in loot-core

Today three places decide what a reconcile locks: the web client, the MCP and (for B1) nothing. B2 puts the selection in loot-core once, `lockPlan(accountId)` in `server/accounts/reconcile-plan.ts`: rows of the account that are cleared, not reconciled and not split children; every child of a selected split parent; the transfer partner ids of those rows (listed, never written); children whose parent is already reconciled named as skipped. The native lock and its preview use it. A contract test builds one fixture (splits, a reconciled parent with an unreconciled child, transfers, an uncleared row) and asserts that this set equals the MCP's `reconciliation()` and the web `lockTransactions` selection, so the three cannot drift. Moving the MCP onto `lockPlan` needs a fork handler and is Backlog.

## D2. Step 3, resolve

`native/reconcile-matches {account_id}` returns, for a difference d not zero, at most the results limit of matches, each `{kind, row ids, amounts}`: `tick-one` (an uncleared, unreconciled, non-child row up to today with amount d), `tick-two` (two such rows summing to d, found with a hash map in linear time), `untick-one` (a cleared, unreconciled row with amount -d). Order: single before pair before untick, then nearest date first. Candidates are capped at the candidates limit (the most recent rows) **before** the pair search, so the work is bounded. Swift shows them and does no arithmetic.

Search is `native/reconcile-rows` with a new `search` argument: a number matches rows by amount and by the digit-swapped amounts (two adjacent digits swapped, as the frame's "also finds $41.08 and $48.10"), text matches payee and notes, case-insensitive. The search text is a string of at most 100 characters (longer fails), bound as a parameter with `%`, `_` and the escape character escaped in the LIKE pattern, so user text is never SQL. The row and summary shapes are B1's.

"Add the missing transaction": the existing mobile add form at `/transactions/new` with the account and the difference filled in. `TransactionEdit.tsx` already reads `account`, `category`, `payee` and `amount`; `amount` is parsed with `parseFloat` as a **decimal in dollars and then negated** (a positive value is a payment). So the contract is the existing one: for a difference of +4180 cents (money missing from the account) native passes `amount=-41.8`, and for -4180 passes `41.8`. Loot-core returns the ready parameter string (`add_amount_param`) with the matches so Swift does no sign or scale arithmetic. The form is made safe: a value that is not finite, or whose size is above 1,000,000,000, reads as 0. The form saves nothing until the person taps Save, and the account is matched by name as today. The native flow closes to the checklist (the account reads In progress); the person adds the row, returns, and the flow re-reads on the change events.

The adjustment is last and never automatic (D4).

## D3. Step 4, lock

`native/reconcile-lock-preview {account_id}` returns the rows to lock (up to the list limit, then a count with `truncated: true`), the linked transfer partners (id, account, amount, date, not locked), skipped children, the counts, the record's amount, source and entered-at, and a `plan_digest` over every row, partner and balance involved, not only the listed ones.

**The Figma step 4 says transfer partner legs "lock too" and counts 17 + 2 = "Lock 19". That contradicts the app and the MCP, which lock only this account's rows; the partner leg is only frozen (the existing rule asks before editing a transfer whose other side is reconciled).** Locking partner rows would change two accounts at once and breaks the story's "the app's own lock behaviour". B2 follows the app: the button reads "Lock 17 transactions" and the partners are listed under "Linked transfers in other accounts (not locked)". The UX Designer updates frame 54:406 and its notes. The unlock note stays: locked rows unlock only in the app (a row's Unlock), never through an assistant.

## D4. The adjustment

`native/reconcile-adjust {account_id, amount, category_id?, label, undoToken}` is a person's action: it requires a usable record, requires `amount` to equal the live difference (a stale sheet fails and changes nothing), and creates one transaction as the app's `createReconciliationTransaction` does: cleared, unreconciled, date today (the app's `currentDay()`; the frame's Nov 30 is the period end and the Designer confirms), `notes` = the localized label the app passes (a string of 1 to 100 characters, else the call fails), no payee, then the rules run; an explicit `category_id` (read live: it must be an existing, non-deleted category and not a group, never on an off-budget account, else the call fails) wins over a rule's. One undo step with the token. No `api/` handler and no MCP tool creates an adjustment: the MCP's reconcile tool never does, and a normal `write_create_transactions` row is not an adjustment. The sheet is a medium-detent sheet with the amount in its button ("Add +$41.80 adjustment") and the line on what happens to the budget. After it, the difference is zero and step 4 lists the adjustment, which can be removed before locking with `native/undo` and its token while it is still the last undoable write, and no longer after a lock; otherwise the sheet says to delete it in the register.

## D5. The lock

`native/reconcile-lock {account_id, plan_digest}`, a mutator that **cannot be undone through the bridge**. `nativeUndo` undoes the latest undo step only when its marker equals the token, and a handler that adds no step would leave the adjustment's (or a tick's) step as the latest, so adjust, lock, then `native/undo` with the adjustment's token would delete the adjustment and leave locked rows with a non-zero difference. The lock therefore registers its own undo step carrying a marker no token matches, so every earlier token is refused after it and the bridge has no path to undo the lock. The app's own Undo gesture, a person's action, reverts that step whole (rows, record and stamp together), which is consistent; unlocking one row stays the app's per-row action:

1. Require a record that is unconsumed and unexpired and a zero difference. Source `cleared` is allowed: it is the person's own reconcile, as on the web, and only the assistant refuses that source (sc-4800).
2. Recompute `lockPlan` and require its digest to equal `plan_digest`, else refuse: "The account changed since this screen. Review it again. Nothing changed."
3. One `batchUpdateTransactions` sets `reconciled` on the rows (children follow parents).
4. Re-read the cleared balance. **Consume the record whenever rows were locked**, matching the MCP rule, including when the re-read no longer matches. Stamp `last_reconciled` only when the balance is verified; a zero-row lock stamps and consumes when verified.
5. Return `{locked_ids, linked_ids, verified, cleared, difference}`. An unverified result says the rows are locked, the balance moved while locking, and to review.

The page supplies no balance and no row list; the record and loot-core decide.

## D6. Done and the checklist

An In progress account (a usable record) reopens at step 2 with the record's balance and source, step 1 one tap back, so a person who added the missing row in the web form is not asked to confirm again. An unverified lock has its own done variant: rows locked, the balance moved, Review (the Designer mocks it before task 2.4). Done follows `last_reconciled` (this month), which the lock stamps, so the checklist needs no new status. The done screen shows the account name, the statement balance and the locked count, a success haptic and a VoiceOver announcement, no confetti, and offers the next due account or the checklist; ✕ returns to wherever the flow began. B1's "finish in the register" exit is replaced by Continue to step 4 at 0.00; "Done for now" stays above zero.

## D7. Limits are settings

Synced preferences, parsed with `^\d+$`, zero or above-ceiling values ignored and the default used, as B1's: `reconcile-match-max-candidates` (300, ceiling 2,000), `reconcile-match-max-results` (5, ceiling 20), `reconcile-lock-list-max-rows` (200, ceiling 2,000). The list limit cuts only what the preview lists: the digest covers every row and the button's count is exact. No limit on how many rows a person may lock (a human action in the app, as on the web).

## D8. Archiving next to `native-reconcile-flow`

That change is merged in code but not archived, so its requirements (including "Step 2 ticks rows against a live difference", whose exit this change replaces) are not in the main spec and cannot be MODIFIED. Here the new requirement "Step 2 continues to the lock" states the replacement; at archive, fold the "Ready to lock — finish in the register" wording out of the older requirement. No requirement header collides.

## D9. Security notes

- New bridge writes: `native/reconcile-adjust` and `native/reconcile-lock`, allowlisted on the Swift and page sides; neither is exposed as an `api/` handler, so no script or MCP tool reaches them by name (a handler-list test pins that; the API's generic `transactions-update` can still set fields, which is how the MCP's own lock works behind its grant). The existing origin checks and undo-token rules apply.
- **Accepted risk until production hardening: the page can drive the lock and the adjustment without a tap.** `account-statement-balance-save` is already allowlisted for the page; it takes any amount for source `entered`, and `cleared` only at the live cleared balance. Injected same-origin script could save a record, then call `native/reconcile-adjust` with the live difference (a large cleared transaction), or save `cleared` at the cleared balance and call the preview and the lock with the digest it just received. The amount and digest checks stop **staleness only**, not a compromised page. Injected same-origin script already has the app's own `send`, so a native-only gate is defence in depth, not a fix (Security accepted this reasoning on the B1 PRs). A Swift-minted one-shot confirmation nonce, issued when the person taps the sheet or Lock and checked and consumed in loot-core by the adjust and lock handlers, is a deferred Backlog story (task 2.6).
- The lock cannot be replayed: the record is consumed, and the digest binds the shown rows.
- Transfers: partner legs are never written by the lock.

## Risks

- The pair search is linear, but the candidates cap keeps it cheap on a large account; if the cap hides the match, search still finds it.
- An unverified lock leaves rows locked and the record consumed; the person re-enters the balance after unlocking in the app if needed.

## Decisions for Ken

None. The two Figma corrections (partner legs not locked, adjustment date) are the Designer's to apply.
