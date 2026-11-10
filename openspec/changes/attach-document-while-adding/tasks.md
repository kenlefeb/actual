# Tasks

Write each test first, run it and see it fail before implementing. Name tests after the spec scenarios. Use only synthetic files. Paths are under `packages/` unless stated. Order: group 2 first, then groups 3 and 4 in parallel (different files); group 1 is this change's spec PR.

## 1. Spec (sc-2622)

- [ ] 1.1 Solution Architect and Product Owner review this change (spec PRs need both). Confirm two undo steps (design decision 6). Verify `npx openspec validate attach-document-while-adding --strict` and `yarn check:openspec-shortcut` pass.

## 2. loot-core validate-only check (sc-3234)

- [ ] 2.1 In `loot-core/src/server/attachments/`, with `mockAttachmentServer.ts`, write failing tests for the new check handler: "Wrong type" and "Renamed file" (by bytes), "Oversize file" and "Limit set by the server", "HEIC photo", "Local-only budget while adding", "Offline pick" (unreachable `/info` returns the connection error), and that a passing file uploads nothing and writes no row. Run them and see them fail. Verify the existing `addAttachment` tests still pass.
- [ ] 2.2 Write failing tests for the batch handler `transaction-attachments-add-batch`: "Undo after adding with two documents" (two documents inserted, one undo removes both), "One document fails" (the others are inserted, the failure is returned), and an empty batch inserts nothing. See them fail.
- [ ] 2.3 Implement the check handler `transaction-attachment-check` (design decision 2), sharing the checks with `addAttachment`, and the batch handler `transaction-attachments-add-batch` (design decision 6, one `withUndo`). Verify the new and existing attachment tests pass.
- [ ] 2.4 Add `transaction-attachment-check` and `transaction-attachments-add-batch` to `mcp/coverage.json` (tool or skip with a reason), named exactly as the handlers are registered. Verify `yarn check:mcp-coverage` passes.

## 3. Phone add screen (sc-3235)

- [ ] 3.1 Write `desktop-client/src/hooks/usePendingAttachments.test.ts`: holds files, removes, clears, refuses a sixth ("Sixth document"), starts with initial files, calls the check handler (`send` mocked via `#mocks/connection`) and holds nothing when it refuses. See it fail, then implement the hook (design decision 4). Verify it passes.
- [ ] 3.2 Write failing tests for `TransactionAttachmentsSection` / `TransactionEdit` on the add screen: "Pick a document while adding on the phone", "Remove a held document", "Refused when picked", "Local-only budget while adding", "Offline pick", "Split while adding". See them fail, then show the Documents section while adding, backed by the hook (remove the `!isAdding` guard). Verify they pass.
- [ ] 3.3 Write failing tests for the save flow: "Add with a document on the phone" (attach runs on the realized parent id from the owner of `onSave`, after the save, then clears), "Cancel while adding" (nothing sent), "Connection lost between pick and save", "One document fails", "Undo after adding with two documents" (the batch call, so two steps). The hook state lives in `TransactionEdit`; also test that the schedule path drops held files. See them fail, then implement the save flow (design decision 3). Verify they pass.
- [ ] 3.4 Update `desktop-client/e2e/transaction-attachments.mobile.test.ts`: replace the check that a new transaction offers nothing with add-with-document and cancel-with-document. Verify it passes locally. The Tester runs the camera and Photos paths on an iPhone and records the result on the PR.
- [ ] 3.5 Run `yarn generate:i18n`, `yarn typecheck`, `yarn lint:fix` and `yarn test`. Verify all pass.

## 4. Desktop add row (sc-3236)

- [ ] 4.1 Write failing tests for the add row in `transactions/TransactionsTable` (reusing the hook from group 3): "Pick a document while adding on desktop" (paperclip with count badge, list under the row with Remove), "Remove a held document", "Refused when picked", "Local-only budget while adding", "Schedule has no paperclip", "Sixth document", "Offline pick". See them fail, then add the control and list (design decision 7). Verify they pass.
- [ ] 4.2 Write failing tests for the add path: "Add with a document on desktop" (the held files reach `TransactionList.onAdd`, through `props.onAdd` or a hoisted hook, and attach on the realized parent id with the batch call; the row resets and the held files clear), "Cancel while adding" (and Add and close), "Split while adding", "Connection lost between pick and save", "One document fails", "Undo after adding with two documents". See them fail, then implement (design decision 3). Verify they pass.
- [ ] 4.3 Add an e2e test in `desktop-client/e2e/` for adding a transaction with a document and for cancelling. Verify it passes locally.
- [ ] 4.4 Run `yarn generate:i18n`, `yarn typecheck`, `yarn lint:fix` and `yarn test`. Verify all pass.

## Workflow follow-up

- Release: bump the eight package versions to the next alpha, add fork release notes and regenerate the fork news, per AGENTS.md (with the last story's PR).
- Archive when sc-3235 and sc-3236 have merged; then point each story's change link at the archive path.
- Not planned here: an offline upload queue for documents (not filed unless Ken asks).
