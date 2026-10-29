# Proposal

## Why

An Amazon purchase arrives in the budget as one opaque "Amazon" card charge, even when it holds groceries, a gift and a household item. To budget it, the user looks up the order and splits it by hand (sc-926). This is slice 1: the user imports Amazon's own order-history export, reviews which charges it matched, and applies a split for each one.

## What Changes

- New experimental feature flag, off by default, for Amazon order itemization.
- The user imports Amazon's order-history export (the CSV from Amazon's "Request your data"). It's read and parsed on the user's device, and the raw file isn't kept.
- The app rebuilds each card charge (one per shipment) from the export's item rows, and matches it to a transaction in any on-budget account by exact amount and date near the ship date. The payee only ranks candidates; it isn't a filter.
- A review step lists every charge as matched (with account, date, amount, payee and items), ambiguous, or not matched with a reason. Orders paid partly by a gift card or points show as "Not matched: paid partly by gift card or points".
- Nothing is written until the user applies a match. Applying turns the bank transaction into a split with one line per item, item names in the notes, and an order link and order marker on the parent. Its bank fields stay unchanged.
- A charge that's already itemized for that order isn't offered again.
- Out of scope for slice 1: refunds and returns, gift-card and points allocation, off-budget accounts, automatic refresh, browser or email sources, and categorizing beyond what existing rules already do.

## Capabilities

### New Capabilities
- `amazon-order-itemization`: Importing Amazon order data, matching each Amazon charge to the bank transaction it belongs to, the review step, and itemizing a confirmed charge as a split.

### Modified Capabilities
- none. Split behavior (`split-transaction-editing`) and note behavior (`transaction-notes`) are used as they are.

## Impact

- `loot-core`:
  - a parser for the order export, which rebuilds charges from item rows;
  - a matcher that builds on the bank-sync fuzzy matching in `server/accounts/sync.ts`;
  - a handler that applies a split to an existing transaction. It's undoable and leaves reconciled and imported fields alone.
- `desktop-client`: an import entry point and a review modal, behind the new flag.
- `FeatureFlag` type and the Experimental settings page: the new flag.
- Test fixtures: a small synthetic export. Ken's real export is used only locally, to confirm the column layout, and is never committed.
- No schema change, no new dependency, no server or sync-server change, and no Amazon credentials anywhere.
