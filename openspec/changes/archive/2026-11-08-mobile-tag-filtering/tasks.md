# Tasks

Test-first: write each test, run it and see it fail before the code (record the failing run). Where a test pins behaviour that already exists (desktop, group 1), record that it passed on its first run.

## 1. Desktop: pin the existing tag filter (sc-2989)

- [x] 1.1 Add tests to `packages/desktop-client/src/components/transactions/TransactionsTable.test.tsx` that clicking a tag calls the tag handler with the tag. There is no `Account.test`, so add a test of the register's `onApplyFilter` path (new `components/accounts/Account.test.tsx`, stubbing the header and the table) that clicking a tag adds `notes hasTags '#tag'` as a pill in a single-account and the all-accounts register, that the same tag twice is not duplicated, and that a second tag adds a second pill (stacking). These pin existing behavior; record that they passed on first run. Verify: `yarn workspace @actual-app/web test TransactionsTable Account`.

## 2. Mobile: filter conditions on single-account lists (sc-2989)

- [x] 2.1 Add failing tests to `components/mobile/accounts/AccountTransactionsTagFilter.test.tsx` (the existing `AccountTransactions.test.tsx` is large and mocks the list differently): `location.state.filterConditions` filters the single-account query via `make-filters-from-conditions`; a tag condition plus typed search text returns only the intersection (AND), and clearing either leaves the other. Run them and see them fail.
- [x] 2.2 Implement `filterConditions` handling in `AccountTransactions.tsx`: copy `location.state.filterConditions` into local state and apply it to `baseTransactionsQuery` so search composes on top. In `AllAccountTransactions.tsx` move the condition from direct reads of `location.state` into the same local state (this changes existing code; report drill-down behavior must not change). Share logic in a hook only if it removes duplication. Verify: 2.1 passes and the On/OffBudget pages still work.

## 3. Mobile: tap a tag, chip, replace (sc-2989)

- [x] 3.1 Add failing tests (run them, see them fail). In `components/mobile/transactions/TransactionListItem.test.tsx`: tapping a tag calls the new handler with the tag and does not open the editor. In `components/mobile/transactions/NotesField.test.tsx`: a tag tap does nothing and does not start editing. In `components/mobile/accounts/AccountTransactionsTagFilter.test.tsx` (single account) and a new `components/mobile/accounts/AllAccountTransactions.test.tsx` (All accounts): tapping a tag shows the "#tag x" chip and filters, its x clears the filter, a second tag replaces the first, and "Filters applied" still shows for drill-down conditions.
- [x] 3.2 Add an optional tap handler to `packages/desktop-client/src/notes/MobileTaggedNotes.tsx` (button role, pressed state, name "Filter by #tag", stops propagation). Make `packages/desktop-client/src/notes/NotesTagFormatter.tsx` forward `onNotesTagClick` to `MobileTaggedNotes` in its `isNarrowWidth` branch. Add the optional prop to `components/mobile/transactions/TransactionListItem.tsx` and pass it from both lists. `NotesField.tsx` passes none.
- [x] 3.3 In `components/mobile/transactions/TransactionListWithBalances.tsx` add a `TagFilterChip` in its own row above the search box (so it also shows in the reconcile layout, which has no spare column), next to the existing `AppliedFiltersChip` row (props `tagFilter`, `onClearTagFilter`; translated strings), and have `AllAccountTransactions.tsx` and `AccountTransactions.tsx` set and clear the tag in their local state. Verify: 3.1 passes.

## 4. Checks and release (sc-2989)

- [x] 4.1 Run `yarn lint:fix`, `yarn typecheck`, `yarn test`, `yarn check:mcp-coverage` and `yarn generate:i18n`.
- [x] 4.2 Release note added (`upcoming-release-notes/mobile-tag-filtering.md`) and change archived after the PR merged. The version bump and fork news were not done here; they stay a release-time step per AGENTS.md "Private customized build versions".
