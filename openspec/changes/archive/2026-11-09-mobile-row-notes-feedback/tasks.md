# Tasks

Test-first: write each test, run it and see it fail before the code (record the failing run).

## 1. Row pressed tint and accessible name (sc-3199)

- [x] 1.1 Add failing tests to `components/mobile/transactions/TransactionListItem.test.tsx`, run them and see them fail: pressing the notes line away from a tag or link shows the row pressed tint and releasing or cancelling clears it; pressing a tag shows no row tint; the row button's accessible name includes the notes text for a row with notes and is unchanged for a row without notes; tags and links are still not descendants of a button. Add a reconcile-layout case.
- [x] 1.1a Add a failing-first test for exactly this: start a press on a link (and on a tag) in a row with notes, never send the press end (as when the link opens a new window or the page loses focus), and assert the row has no pressed tint; then tap the row and assert the transaction opens. Run it and see it fail before the code.
- [x] 1.2 Implement in `components/mobile/transactions/TransactionListItem.tsx` per design decisions 1 and 2 (press-state tint, `aria-labelledby` with `useId`). Verify: 1.1 passes and the resting-state VRT snapshots do not change.
- [x] 1.3 Extend `packages/desktop-client/e2e/mobile-list-a11y.mobile.test.ts` with the name check; keep the sc-3070 nesting assertions. Run it before and after and record the result.

## 2. Checks and release (sc-3199)

- [x] 2.1 Run `yarn lint:fix`, `yarn typecheck`, `yarn test` and `yarn generate:i18n`.
- [x] 2.2 Add a release note in `upcoming-release-notes/`; archive the change after the PR merges (the spec syncs then). The version bump and fork news stay a release-time step per AGENTS.md "Private customized build versions".
