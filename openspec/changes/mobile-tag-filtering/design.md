# Design

## Decisions

1. **Target: the list the user is in**, as on desktop (`TransactionList` calls `onApplyFilter({field: 'notes', op: 'hasTags', value: '#tag', type: 'string'})`, which `Account.tsx` adds to the open register). On mobile the list owns the condition; no navigation to another page.
2. **Reuse, not search.** Mobile keeps the active condition in the list's state, seeded from `location.state.filterConditions` (the report drill-down path `AllAccountTransactions` already reads), and feeds it to `make-filters-from-conditions`. The text search box is not used: it matches substrings, `hasTags` matches whole tags.
3. **Single-account lists get the same support.** `AccountTransactions.tsx` gains `filterConditions` handling mirroring `AllAccountTransactions.tsx`; the On/OffBudget pages inherit it. The hide-reconciled preference still applies because the existing query builder is unchanged.
4. **One tag at a time.** Applying a tag replaces any existing tag condition (Product Owner, sc-2989 activity-3059). Other conditions that arrived through `filterConditions` (report drill-downs) are kept.
5. **Clear with a chip.** Mobile has no filter pills, so a removable "#tag x" chip above the list drops the tag condition. Back navigation leaves the filtered view as before.
6. **Tap handling.** `MobileTaggedNotes` takes an optional tap handler. In a list it applies the filter, stops propagation so the row does not open the editor, and is exposed as a button (visible pressed state, accessible name "Filter by #tag"). Where no handler is passed (the editor) it stays inert and does not start editing.

## Known gap (named, not closed)

In the mobile transaction editor a tag tap does nothing. Navigating away could lose unsaved edits, so the Product Owner kept the editor out of scope (sc-2989, activity-3059). A follow-up may revisit it.

## Desktop parity

Desktop already filters from the register (`NotesTagFormatter` -> `TransactionsTable` -> `TransactionList` -> `Account.tsx onApplyFilter`; it dedupes identical conditions and shows a removable pill in `AppliedFilters`). Only tests are added, so the specified scenarios are pinned on both platforms.

## Risks

Filtered mobile lists page through the same query as the All accounts report drill-down, so large histories behave as that path does today.
