# Tasks

Test-first: write each test, run it and see it fail before the code (record the failing run). Where a test pins behaviour that already exists (desktop, group 2), record that it passed on its first run.

## 1. Tester: axe on the live list, failing first (sc-3070)

- [x] 1.1 Add `packages/desktop-client/e2e/mobile-list-a11y.mobile.test.ts` (Playwright, mobile viewport, axe-core added as an explicit dev dependency of `@actual-app/web`): open the All accounts list and one account's list with a transaction whose notes have a tag and a link, run axe, assert that no tag or link is a descendant of a `<button>` and that no `nested-interactive` node contains one (option rows flagged only for the upstream `ListBoxItem` wrapper are excluded; say so in a test comment, design decision 8). Run it against the current code on the live list and record the failure (rule, node, impact). Record every other axe finding with its selector; file a Shortcut `bug` story only for nodes in fork-added UI, not for upstream's. Verify: `yarn workspace @actual-app/web run playwright test mobile-list-a11y.mobile.test.ts`.

## 2. Desktop: pin the separate tag control (sc-3070)

- [x] 2.1 Add a test to `packages/desktop-client/src/components/transactions/TransactionsTable.test.tsx` that the register's tag is a button that is not a descendant of another button. It pins existing behavior; record that it passed on first run. Verify: `yarn workspace @actual-app/web test TransactionsTable`.

## 3. Mobile: notes line as a sibling of the row button (sc-3070)

- [x] 3.1 Add failing tests to `components/mobile/transactions/TransactionListItem.test.tsx`, run them and see them fail: no `button` ancestor contains the tag or link; tapping the notes line away from a tag opens the transaction; long-pressing the notes line selects; long-pressing a tag selects nothing, applies no filter and does not open; the tag still has role button and name "Filter by #tag"; a link stays a link. Add a case for the reconcile layout. Add to `components/mobile/transactions/NotesField.test.tsx` that a tag tap in the editor does nothing and does not start editing (pins the decision; record whether it already passed).
- [x] 3.2 Restructure `components/mobile/transactions/TransactionListItem.tsx`: row container with the existing `Button` (payee, category, amount) and a sibling notes element carrying the same merged press and long-press props. Keep layout, ellipsis and pressed feedback unchanged; keep `MobileTaggedNotes` stopping propagation. Verify: 3.1 passes and existing mobile VRT snapshots are unchanged.
- [x] 3.3 Re-run 1.1 and record that it now passes on the live list.

## 4. Checks and release (sc-3070)

- [x] 4.1 Run `yarn lint:fix`, `yarn typecheck`, `yarn test` and `yarn generate:i18n`.
- [x] 4.2 Add a release note in `upcoming-release-notes/`; archive the change after the PR merges. The version bump and fork news stay a release-time step per AGENTS.md "Private customized build versions".
