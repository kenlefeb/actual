# Tasks

Write each test first, run it and see it fail before implementing. Name tests after the spec scenarios. Use only synthetic exports; never read Ken's real order export. Paths are under `packages/desktop-client/` unless stated.

## 1. Shared review hook (sc-2556)

- [x] 1.1 Write `src/components/accounts/useAmazonOrderReview.test.ts` with `send` mocked through `#mocks/connection`: Matched rows start chosen; `apply(ids)` sends `amazon-orders-apply` with only those charges and their transaction ids, and returns the result; group titles and skip reasons match today's desktop strings. See it fail, then extract the hook from `ImportAmazonOrdersModal.tsx` (design decision 3) and refactor the modal onto it. Verify the new tests and the unchanged `ImportAmazonOrdersModal.test.tsx` pass.

## 2. Entry point (sc-2556)

- [x] 2.1 Write `src/components/modals/AllAccountsMenuModal.test.tsx` with `#hooks/useFeatureFlag` mocked: "Hidden on the phone when the feature is off" and "Offered on the phone when the feature is on" (the row exists and pressing it calls `window.Actual.openFileDialog` with a `csv` filter). See them fail, add the row (design decision 1), verify they pass.
- [x] 2.2 In `src/components/accounts/importAmazonOrders.test.ts`, confirm "Not an order export on the phone" is covered by the existing refusal test (same function, same message); if not, add it. Verify it passes.

## 3. Phone review (sc-2556)

- [x] 3.1 Create `src/components/modals/MobileImportAmazonOrdersModal.test.tsx` with synthetic `AmazonChargeReview` objects and `send` mocked. Failing tests: "Matched charge on the phone" (order id, ship date, amount, items, account, date, payee), "Reconciled match on the phone", group order and titles, "Ambiguous charge on the phone" and "Gift card charge on the phone" (no Apply, no select, the hints from design decision 5), "Close without applying on the phone" (closing sends nothing), "Import stays on the phone" (closing sends nothing and makes no network request). Implement the modal (decisions 2 and 5) and the `isNarrowWidth` swap in `src/components/Modals.tsx`. Verify they pass.
- [x] 3.2 In the same file, failing tests: "Apply one charge on the phone" (sends one match; that card shows Applied, others keep Apply), "Apply all on the phone" (one call with every unapplied Matched charge), "Undo on the phone" (the notification's button dispatches undo and the cards show Apply again), and "Changed after the review, on the phone" (a `split` skip shows the shared reason on the card). Implement decision 4. Verify they pass.

## 4. Mobile e2e and device check (sc-2556)

- [x] 4.1 Add `e2e/amazon-orders.mobile.test.ts` (390x844) with page-model helpers in `e2e/page-models/`: turn the flag on in Experimental settings, create a budget with a card transaction matching a charge in loot-core's synthetic fixture `src/server/amazon-orders/__fixtures__/order-history.csv` (read by path, so a layout change in sc-926 task 1.1 updates both), open All Accounts → "Import Amazon orders", pick the fixture through the `filechooser` event, check the Matched card, the read-only gift-card group and its hint, tap "Apply", check the transaction is split, tap Undo and check it isn't. Verify it passes locally (`E2E_WORKERS=1 yarn workspace @actual-app/web playwright test amazon-orders.mobile.test.ts --workers=1`).
- [ ] 4.2 The Tester runs the branch on an iPhone (Safari and the home-screen app) with the synthetic fixture saved to Files, and records on the PR with screenshots: the CSV can be picked, the review fills the screen, Apply, Apply all and Undo work. If the CSV is greyed out, apply the `accept` fix from the design's first risk and recheck. Verify the Tester's comment shows each check passing.
- [x] 4.3 Run `yarn generate:i18n`, `yarn typecheck`, `yarn lint:fix` and `yarn test`. Verify all pass.

## Workflow follow-up

- Release: bump the eight package versions to the next alpha, add fork release notes and regenerate the fork news, per AGENTS.md.
- Archive after `amazon-order-itemization` (sc-926) is archived, so this delta applies to the main spec it creates; then point sc-2556's change link at the archive path.
- Not planned here: choosing an Ambiguous charge's transaction on the phone (sc-2588, Backlog, only if Ken uses step 1).
