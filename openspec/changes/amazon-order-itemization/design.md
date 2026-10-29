# Design

## Context

See proposal.md (Why) and `specs/amazon-order-itemization/spec.md` for the required behavior. This section covers only what the approach depends on.

- **The data source:** Amazon's "Request your data" export, explored on sc-926. It has one row per item and no per-charge record, so charges have to be rebuilt. **Its column names haven't been checked yet.** Nothing in the spec or code may depend on a guessed column until task 1.1 confirms the layout against a real export.
- **File parsing today:** bank files go through `transactions-parse-file` (`server/transactions/import/parse-file.ts`). It reads the file through `#platform/server/fs` and parses CSV with `csv-parse`, all inside the loot-core worker on the user's device.
- **Bank-sync matching today:** `matchTransactions` (`server/accounts/sync.ts`) works one account at a time, in the opposite direction: incoming bank rows against existing transactions. It does exact-amount matching within ±7 days, ranks candidates by nearest date, and prefers rows without an `imported_id`. We need the reverse direction across every on-budget account, so we reuse its ranking idea, not the function itself.
- **What reconcile does to a matched transaction on re-sync:** it keeps the existing notes (`existing.notes || trans.notes`), copies date and cleared changes to the split lines, and doesn't change the amount. That is what makes "Itemization survives bank re-sync" hold without new code. A test pins it.
- **Rules:** they run on import and bank sync (`runRules` in `server/transactions/transaction-rules.ts`), not on a user's split edit. Applying a match therefore has to run them on the new lines itself.

## Goals / Non-Goals

**Goals:**
- One normalized order model that a later source (a browser export, the payments-transactions feed) can feed without changing matching or applying.
- Matching and applying in `loot-core`, with no network request and no persistence beyond the applied edits.

**Non-Goals:**
- Mobile UI.
- The public API (`@actual-app/api`).
- A saved import history.
- A per-category grouping option.

## Decisions

### 1. A source adapter turns the export into a normalized order model
```
export file --adapter--> Order { id, paymentMethods[], charges[] }
                         Charge { orderId, shipDate, amount, items[] }
                         Item { name, quantity, price, tax, shipping, discount }
```
- The adapter is the only code that knows the export's column names and payment-method words. It's a single table of field-to-column names, plus the gift-card and points keywords.
- If a needed field is missing, it reports which ones are missing (spec: "Required order fields").
- *Alternative:* map columns straight into the matcher. Rejected, because it would tie matching to one file layout.

### 2. Charges are grouped by order and ship date
- Group key: order id plus ship date. The amount is the sum, in integer cents, of price × quantity + tax + shipping − discount over the group's items.
- If the export also gives a per-shipment total and it disagrees with that sum, use the export's total and record the difference on the charge, which the review shows.
- *Alternative:* subset-sum matching over an order's items. Deferred: grouping by ship date covers split shipments in the explore findings, and subset-sum adds ambiguity for little gain in slice 1.

### 3. Parsing runs in the worker; nothing is stored
- A new handler, `amazon-orders-parse`, takes the chosen file the way `transactions-parse-file` does: through the platform fs, in the worker.
- It returns the charges plus the match results computed from them.
- The raw rows aren't written to the database, preferences or the sync log. When the review closes, the client drops the result.

### 4. Matching runs one query, then a one-to-one assignment
Matching:
- One query finds on-budget, non-tombstoned, non-split transactions (neither parents nor children), with an amount among the charges' negated amounts, dated from the earliest ship date −1 to the latest +5 days.
- Each charge's candidates are those with its exact amount, dated from its own ship date −1 to +5 days.

Ranking:
- First, whether the payee name or `imported_payee` looks like Amazon (case-insensitive `amazon` or `amzn`).
- Then the distance from the ship date.

Assignment:
- Greedy assignment in charge order gives each charge its best free candidate.
- If two candidates for a charge rank equally, or one transaction is the best candidate for two charges with equal claims, those charges become ambiguous and nothing is assigned among them (spec: "One transaction per charge").

Before matching, a charge is flagged as:
- already itemized, when a split parent of its amount in the date window carries the marker for its order. A second small query finds these, since split parents aren't candidates;
- gift card or points, from its order's payment methods.

*Alternative:* call `matchTransactions` per account. Rejected: it runs rules and takes bank rows as input, and it can't do a one-to-one assignment across accounts.

### 5. Applying is one undoable mutation that re-checks each match
- `amazon-orders-apply` takes the matches the user confirmed (charge plus transaction id) and runs as one `mutator(undoable(...))` step.
- For each match, it re-reads the transaction. It skips it, with a reason, if the transaction's amount changed, it's now split, it's deleted, or it already carries the marker. The review shows those reasons.
- Otherwise it writes the children through the existing split-writing path (`batchUpdateTransactions` with child rows), so split invariants hold. The parent changes only in its notes.

### 6. Allocation and rounding
- Each line is its item's price × quantity. Tax, shipping and discount are spread across the lines in proportion to those prices, in integer cents.
- Leftover cents go to the largest line, so the lines always add up to the transaction amount.
- Lines are negative, like the parent expense.

### 7. Notes and the marker
- Line note: `<item name> ×<quantity>`.
- Parent note: any existing text, then a new line with `#amazon`, then the order-details link (`https://www.amazon.com/gp/your-account/order-details?orderID=<id>`).
- The marker for an order is `#amazon` together with that order's link. That's how "Already itemized" is detected.
- `#amazon` is an ordinary tag, so the user can filter itemized transactions by it.
- *Alternative:* one tag per order. Rejected, because it would fill the tag list with order numbers.

### 8. Rules set categories only
- For each new line, run `runRules` on a copy shaped like an imported transaction: the parent's account, payee and date, plus the line's note and amount. Keep only the resulting `category`.
- This gives per-item categorization from existing rules without letting a rule rename the payee or move the account (spec: "Rules can categorize items").

### 9. UI is desktop only, behind a new flag
- The `FeatureFlag` is `amazonOrderItemization`, toggled on the Experimental settings page.
- Entry point: "Import Amazon orders" in the accounts page menu (the all-accounts view of the account header menu).
- It opens a review modal that groups charges into Matched, Ambiguous, Not matched, Gift card or points, and Already itemized.
  - Matched rows show account, date, amount, payee and items, each with a checkbox.
  - Ambiguous rows offer their candidates.
  - "Apply selected" applies the checked rows; closing writes nothing.
- *Alternative:* extend `ImportTransactionsModal`. Rejected: that modal is per-account and imports new transactions, while this one edits existing ones across accounts.

## Risks / Trade-offs

- **[Risk] The export's columns or payment-method words differ from what the explore pass remembered.**
  → Task 1.1 confirms them on Ken's export before any parser code. The adapter keeps them in one table, and the missing-fields error makes a layout change visible instead of silent.
- **[Risk] Amazon's total differs from the bank amount** (currency conversion, final-charge adjustment, digital or Subscribe & Save batches).
  → The charge isn't matched, and the review lists it as not matched, with its items, so the user sees what was missed.
- **[Risk] A wrong match is applied** (same amount, nearby date, different purchase).
  → The review shows the account, payee and items before applying, ambiguous charges are never auto-assigned, and applying is undoable.
- **[Risk] A large multi-year export is slow.**
  → One indexed query by amount and date range. The review groups its results and paginates the Matched list if needed.
- **[Trade-off] Gift-card and points orders can't be itemized in slice 1.** They're listed, never hidden (spec: "Gift cards and points are not matched").

## Migration Plan

- There's no schema or data migration. The feature ships off behind its flag.
- Rollback: turn the flag off. Undo removes any applied splits, or the user can delete the splits by hand.

## Open Questions

- The exact column names and payment-method words. Task 1.1 settles them, and they only fill the adapter's table: they don't change the specs or the approach.
- Whether the export includes Whole Foods, Fresh or digital orders. If it does, the adapter skips rows with no ship date, and those charges show as not matched.
