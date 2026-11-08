# Design

## Decisions

1. **Target: the list the user is in**, as on desktop (`TransactionList` calls `onApplyFilter({field: 'notes', op: 'hasTags', value: '#tag', type: 'string'})`, which `Account.tsx` adds to the open register). On mobile the list owns the condition; no navigation to another page.
2. **Reuse, not search.** The tag is a `filterConditions` entry fed to `make-filters-from-conditions`, not text typed in the search box (search matches substrings, `hasTags` whole tags). **State moves into the list.** Today `AllAccountTransactions` derives `isFiltered` and its query straight from `location.state.filterConditions` (render and effect). That changes: the component copies `location.state.filterConditions` into local state once (the report drill-down still seeds it), and the query, `isFiltered` and the chip read local state, so the chip can clear the tag without touching router state. `AccountTransactions` gets the same local state, seeded the same way.
2a. **Tag filter plus typed search compose with AND.** `AccountTransactions` builds `baseTransactionsQuery` and `useTransactionsSearch` replaces the query through `setTransactionsQuery`; the tag condition is applied to the base query, so search runs on top of it. Clearing the search leaves the tag filter; clearing the tag leaves the search text. A test covers a tag filter plus search text returning only the intersection.
3. **Single-account lists get the same support.** `AccountTransactions.tsx` gains `filterConditions` handling mirroring `AllAccountTransactions.tsx`; the On/OffBudget pages inherit it. The hide-reconciled preference still applies because the existing query builder is unchanged.
4. **One tag at a time on mobile.** Applying a tag replaces any existing tag condition (Product Owner, sc-2989 activity-3059). Other conditions that arrived through `filterConditions` (report drill-downs) are kept. This is mobile only: desktop stacks tags (see Desktop parity).
5. **Clear with a chip.** Mobile has no filter pills, so a removable "#tag x" chip drops the tag condition. `components/mobile/transactions/TransactionListWithBalances.tsx` already renders a read-only `AppliedFiltersChip` ("Filters applied") when `filtered` is true. Decision: keep it as is for report drill-down conditions and add a sibling `TagFilterChip` in its own row above the search box (so it also shows in the reconcile layout, which has no spare column), in that file, carrying the tag and the clear action (props `tagFilter` and `onClearTagFilter` on `TransactionListWithBalances`). "Filters applied" shows only when there are conditions besides the tag. Back navigation leaves the filtered view as before.
6. **Tap handling and plumbing.** `packages/desktop-client/src/notes/MobileTaggedNotes.tsx` takes an optional tap handler. `NotesTagFormatter.tsx` (same folder) today passes `onNotesTagClick` only to `DesktopTaggedNotes`; its `isNarrowWidth` branch must forward it to `MobileTaggedNotes`. `components/mobile/transactions/TransactionListItem.tsx` gets a new optional prop (for example `onNotesTagClick`) that it hands to `NotesTagFormatter`; both lists pass it. In a list the tap applies the filter, stops propagation so the row does not open the editor, and is exposed as a button (visible pressed state, accessible name "Filter by #tag"). `components/mobile/transactions/NotesField.tsx` (the editor) passes no handler, so it stays inert and does not start editing. Two recorded consequences: a long press on a tag no longer opens the row's multi-select (the tag is its own tap target), and the tag is a `role="button"` span inside the row's button, a nested-interactive pattern an axe check may flag; its accessible name is "Filter by #tag" and the row has no other keyboard path to the tag.

## Single-account lists with a condition

While any condition is active (tag or drill-down), `AccountTransactions` matches All accounts: split children are listed, scheduled previews and running balances are off (balances over a subset would be wrong). Both lists hold their query back (`undefined`) until the filters for the current conditions are resolved, so unfiltered rows never show under the chip.

## Known gap (named, not closed)

In the mobile transaction editor a tag tap does nothing. Navigating away could lose unsaved edits, so the Product Owner kept the editor out of scope (sc-2989, activity-3059). A follow-up may revisit it.

## Desktop parity

Desktop already filters from the register (`NotesTagFormatter` -> `TransactionsTable` -> `TransactionList` -> `Account.tsx onApplyFilter`; it dedupes identical conditions and shows a removable pill per condition in `AppliedFilters`). Desktop STACKS: clicking `#vacation` then `#work` leaves two pills and both conditions apply. Replace-on-second-tag and the single chip are mobile only. Only tests are added on desktop. "Desktop" here means the wide layout; a narrow desktop window (`isNarrowWidth`) renders `MobileTaggedNotes` and is covered by the mobile scenarios.

## Risks

Filtered mobile lists page through the same query as the All accounts report drill-down, so large histories behave as that path does today.
