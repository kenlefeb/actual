# Tasks

Test-first: write each test, run it and see it fail before the code (record the failing run). Where a test pins behaviour that already exists (desktop, group 1), record that it passed on its first run.

## 1. Desktop: pin the existing tag filter (sc-2989)

- [ ] 1.1 Add tests in `packages/desktop-client/src/components/transactions/` (and `Account` where it fits) that clicking a tag adds `notes hasTags '#tag'` to the register's filters, in a single-account and the all-accounts register, and that the same tag twice is not duplicated. These pin existing behavior; record that they passed on first run. Verify: `yarn workspace @actual-app/web test <file>`.

## 2. Mobile: filter conditions on single-account lists (sc-2989)

- [ ] 2.1 Add failing tests to `components/mobile/accounts/AccountTransactions.test.tsx`: `location.state.filterConditions` filters the single-account query via `make-filters-from-conditions`; the filtered empty state shows when nothing matches. Run them and see them fail.
- [ ] 2.2 Implement `filterConditions` handling in `AccountTransactions.tsx`, mirroring `AllAccountTransactions.tsx`; share logic in a hook only if it removes duplication. Verify: 2.1 passes and the On/OffBudget pages still work.

## 3. Mobile: tap a tag, chip, replace (sc-2989)

- [ ] 3.1 Add failing tests (run them, see them fail): tapping a tag in the list item applies the filter and does not open the editor; the chip shows "#tag x"; its x clears the filter; a second tag replaces the first; a tag in the editor (`TransactionEdit`) does nothing and does not start editing. Cover All accounts and a single account.
- [ ] 3.2 Add an optional tap handler to `notes/MobileTaggedNotes.tsx` (button role, pressed state, name "Filter by #tag", stops propagation), pass it from `TransactionListItem.tsx` through both lists, and pass none from the editor.
- [ ] 3.3 Add the removable tag chip above both lists (translated strings). Verify: 3.1 passes.

## 4. Checks and release (sc-2989)

- [ ] 4.1 Run `yarn lint:fix`, `yarn typecheck`, `yarn test`, `yarn check:mcp-coverage` and `yarn generate:i18n`.
- [ ] 4.2 Version bump, release note and fork news per AGENTS.md "Private customized build versions"; archive this change when the PR merges.
