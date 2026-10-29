# Tasks

## 1. Export layout and fixture

- [ ] 1.1 Confirm the order export's layout against a real export Ken provides, used only on Ken's machine or a local worktree and never committed.
  - Record the column that carries each field the spec needs: order id, ship or charge date, item name, quantity, item price, tax, shipping, discounts and payment method.
  - Record the payment-method words used for gift cards, gift certificates and points, and whether a per-shipment total exists.
  - Write these into the adapter table in design.md decision 1. Verify that design.md names every needed field, and that no spec scenario names a column.
- [ ] 1.2 Add a small synthetic fixture under `packages/loot-core/src/server/amazon-orders/__fixtures__/`, in the confirmed layout, with fictional orders.
  - It covers a split shipment, a two-item charge with tax, a rounding case, a gift-card order, two same-amount same-day orders, and a charge with no matching transaction.
  - Verify that it contains no real order ids, names or addresses. The Tester reviews it for that.

## 2. Parse the export into charges

- [ ] 2.1 Write failing tests in `amazon-orders/parse.test.ts`, named after the spec scenarios: "Not an order export", "Split shipment", and gift-card detection for "Order paid partly by a gift card". Verify they fail.
- [ ] 2.2 Implement the adapter and the charge grouping (design decisions 1 and 2) in `amazon-orders/parse.ts`, in integer cents. Verify that 2.1 passes, and that a missing field's error names it.
- [ ] 2.3 Make `amazon-orders-parse` delete its `/uploads` copy on the web build after reading it, on success and on failure (design decision 3). Test it with the web platform's fs, and verify that the file is gone in both cases.

## 3. Match charges to transactions

- [ ] 3.1 Write failing tests in `amazon-orders/match.test.ts` against a real test database, named after the scenarios:
  - "Charge posts two days after shipping";
  - "Outside the date window";
  - "Already split by hand";
  - "Two equal candidates";
  - "Payee is a hint, not a filter";
  - "Two same-day orders of the same amount";
  - "Paid with a card that isn't in the budget";
  - "Transfer is never a candidate";
  - "Annotated for another order": a transaction annotated for order A is never a candidate for order B.

  Add two more tests: an off-budget account's transaction is never a candidate, and a split parent of the exact amount without a marker shows "Already split". Verify they fail.
- [ ] 3.2 Implement the query and the one-to-one assignment (design decision 4). Verify that 3.1 passes.

## 4. Apply a match as a split

- [ ] 4.1 Write failing tests in `amazon-orders/apply.test.ts`, named after the scenarios:
  - "Apply a two-item charge";
  - "Rounding";
  - "Existing note kept";
  - "Undo apply-all";
  - "Rule sets the category from the note";
  - "Import the same export twice";
  - "A free item";
  - "Single-item charge";
  - "Rule that sets a new payee": no payee row is added;
  - "No rule matches a categorized charge", "A rule overrides the former category" and "Single-item charge takes a rule's category";
  - "Itemize a reconciled charge": the lines are cleared and reconciled, and the reconciled balance is unchanged;
  - "Bank sync updates the date": calls `reconcileTransactions` on the itemized transaction, and pins that a rule's category can land on the split parent (existing upstream behavior);
  - "Bank file imported again": calls `reconcileTransactions` with a file-style row (no `imported_id`) for an itemized multi-line charge and for an annotated single-item charge, and checks that each matches the original transaction.

  Also cover:
  - apply skips, with a reason, a transaction whose amount changed, that was split, that became a transfer, or that was annotated for any order after the review;
  - a rule that would rename the payee leaves the parent's payee alone;
  - a schedule's own rule never sets a line's category.

  Verify they fail.
- [ ] 4.2 Add the category-only rules helper next to `runRules` (design decision 8), with unit tests: it returns the category of the last matching `set category` rule, ignores schedule rules, and inserts no payee. Verify that the tests and the existing `transaction-rules` tests pass.
- [ ] 4.3 Implement `amazon-orders-apply` (design decisions 5 to 7, 10 and 11) as one undoable mutation, and register `amazon-orders-parse` and `amazon-orders-apply` in the app's handlers. Verify that 4.1 passes, along with the existing `server/accounts` and `server/transactions` tests.

## 5. Flag, entry point and review

- [ ] 5.1 Add the `amazonOrderItemization` flag (off by default) to the `FeatureFlag` type, `useFeatureFlag` defaults and the Experimental settings page. Write the tests "Hidden when the feature is off" for the accounts menu, and "Turned off after applying": an applied split stays unchanged after the flag is turned off. Verify that the first fails before the menu item exists, and that both pass after.
- [ ] 5.2 Add the "Import Amazon orders" menu item and the review modal (design decision 9), with tests named after the scenarios:
  - "Offered when the feature is on";
  - "Import stays on the device", which spies on the network connection and checks that no request leaves the worker;
  - "Close the review";
  - choosing a candidate for an ambiguous charge;
  - a reconciled match is marked "Reconciled";
  - a gift-card charge has no checkbox.

  Verify that the tests and `yarn typecheck` pass. Tell the Director before editing `accounts/Header.tsx`, because other stories touch that file.
- [ ] 5.3 Add a release note in `upcoming-release-notes/` and a short experimental-feature section in `packages/docs/`. Both must say the export is read on the device and nothing is sent anywhere. Verify that `yarn workspace docs build` succeeds.

## 6. Check with a real export

- [ ] 6.1 On staging, with the flag on, Ken imports his real export into the Monarch migration test budget.
  - Check that the matched, ambiguous and not-matched groups look right, that applying one charge produces the expected split, and that undo restores it.
  - Record the results on sc-926, without order data.

## Workflow follow-up

- When archiving, add `amazon-order-itemization` to epic #543's spec list and to the epic table in `docs/agents/issue-tracker.md`, and create the `spec:amazon-order-itemization` label.
- File Backlog stories in #543 for the deferred items:
  - refunds and returns;
  - gift-card and points allocation;
  - the browser-export or payments-transactions source;
  - off-budget accounts;
  - mobile;
  - per-category grouping.
