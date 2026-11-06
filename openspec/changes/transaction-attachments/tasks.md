# Tasks

Write each test first and see it fail before implementing. Name tests after the spec scenarios they cover. Use only synthetic test files and test budgets; never read Ken's real budget data.

## 1. Data model (sc-2346)

- [ ] 1.1 Add the migration `packages/loot-core/migrations/<ts>_add_transaction_attachments.sql`, with an id that sorts above `1793400000000`, holding the `transaction_attachments` table from design decision 1, and add the table to the AQL schema including its `tombstone` field. Verify that the additive-migrations test and `yarn typecheck` pass, and that a test inserting a row through `db` and reading it back with `aqlQuery` succeeds.

## 2. Sync-server endpoints (sc-2346)

- [ ] 2.1 Add the `attachments.fileSizeLimitMB` (10) and `attachments.budgetQuotaMB` (1024) config values with their env vars, and `attachments: { fileSizeLimitMB }` in `GET /info`. Verify with a test that `/info` returns 10 by default and 5 when the env var is set to 5.
- [ ] 2.2 Add `src/util/attachments.ts` (magic-byte type check, HEIC detection) and the attachment path helper in `src/util/paths.ts`. Write failing unit tests first: PDF, JPEG, PNG and WebP headers accepted; text, DOCX and a text file named `.pdf` refused; HEIC reported as `heic`; an id like `../file-x` rejected. Verify they pass.
- [ ] 2.3 Write failing tests in `app-sync.test.ts` named after the spec scenarios "Server checks too", "Quota reached", "No access", "Not signed in" and "Path in the id", plus: upload then download returns the same bytes; an encrypted upload of non-PDF bytes under the limit is stored; delete removes the blob. Also test that an upload with an existing attachment id overwrites the blob, and that an encrypted upload exactly at the limit is accepted while one byte more is refused. Implement `upload-attachment`, `download-attachment` and `delete-attachment` (design decision 2). Verify the tests pass.

## 3. Client handlers (sc-2346)

- [ ] 3.1 Add `loot-core/src/shared/attachments.ts` (the same type check as 2.2) with unit tests over the same sample headers. Verify they pass.
- [ ] 3.2 Write failing tests for `transaction-attachment-add`, `-open` and `-remove` against a test budget with the server calls mocked at the fetch boundary, named after "Attach a PDF", "Attach a second document", "Upload fails", "Oversize file", "Wrong type", "Renamed file", "HEIC photo", "Limit set by the server", "Local-only budget", "Encrypted budget", "Unencrypted budget", "Unencrypted attachment in an encrypted budget", "Opened before, now offline", "Never opened, offline", "Remove", "Undo a removal" and "Attach from a split line". Also test that a failed row write after a 200 upload calls `delete-attachment` once. Implement `server/attachments/app.ts` (design decisions 3 and 4). On the web build, copy the downloaded or encrypted bytes into their own buffer before writing them to the cache; don't cache the raw `encrypt()` output, whose buffer may be a view over a larger one. Verify the tests pass.
- [ ] 3.3 Add `skip` entries for the three handlers to `packages/mcp/coverage.json` ("No MCP tool yet; the read tool is sc-2526"). Verify `yarn check:mcp-coverage` passes.

## 4. Transactions (sc-2346)

- [ ] 4.1 Write failing tests in `transactions/merge.test.ts` for "Merge keeps both documents" and that one undo restores both transactions and their attachments. Move attachments to the kept id in `merge.ts` (design decision 5). Verify the tests pass.
- [ ] 4.2 Write a failing test for "Delete and undo": deleting a transaction (and a split parent, covering its children) tombstones its attachment rows in the same batch, and one undo restores the transaction and the rows. Implement it in `batchUpdateTransactions` (design decision 5). Verify it passes.

- [ ] 4.3 Write failing tests in `encryption/app.test.ts` (or next to `keyMake`) for "New key keeps documents readable" and "Re-encryption fails", with the server mocked at the fetch boundary: after `key-make`, each encrypted attachment's blob was re-uploaded under the same id and its row's `encrypt_meta` names the new key; an unencrypted attachment is untouched; on a refused re-upload `key-make` throws before `resetSync`, and every attachment decrypts with the old key. Implement design decision 8. Verify they pass.

## 5. Desktop UI (sc-2346)

- [ ] 5.1 Add "Attach document…" to `SelectedTransactionsButton.tsx` (one selected transaction only), the hidden file input, and the refusal and "needs a sync server" notifications, all translated. Verify with a component test for "Several transactions selected" and "Local-only budget", and by attaching a PDF on the demo budget with a local sync server (`yarn start:server-dev`).
- [ ] 5.2 Add the register paperclip and its popover (list, Open, Remove), with split lines showing the parent's paperclip. Verify with a component test for "Indicator shown" and "No indicator", and in the running app.
- [ ] 5.3 Add the export notice to `settings/Export.tsx`. Verify "Export a budget with attachments" with a test that the exported zip holds only `db.sqlite` and `metadata.json`, and that the notice renders.
- [ ] 5.4 Open a PDF and a PNG in the web build and in the Electron dev build. If Electron doesn't render the blob window, add the `shell.openPath` fallback from design decision 6. Verify both builds show the document.
- [ ] 5.5 Run `yarn generate:i18n`, `yarn typecheck`, `yarn lint:fix` and `yarn test`. Verify all pass.

## 6. Cross-device check (sc-2346)

- [ ] 6.1 Test "Attached on one device, opened on another" against a local sync server (`yarn start:server-dev`) with two separate browser profiles signed in to the same budget: profile A attaches a PDF, profile B syncs, shows the paperclip and opens the same PDF. The web e2e suite has no sync server today, so this is a Tester-run check unless the Developer adds one; record the steps and result (screenshots of both profiles) on the PR. Verify the Tester's comment shows it passing.

## Workflow follow-up

- Release: bump the eight package versions to the next alpha, add fork release notes and regenerate the fork news, per AGENTS.md. No production change is needed beyond deploying the release.
- On archive: add `transaction-attachments` to epic 543's description, create the `spec:transaction-attachments` label, point sc-2346's change link at the archive path.
- Deferred items already have Backlog stories under epic 543: mobile attach and camera (sc-2523), export inclusion (sc-2524), orphaned-blob cleanup after 30 days, for tombstoned rows and for a deleted budget's attachments folder (sc-2525), MCP read tool for attachment metadata (sc-2526). sc-2526 replaces the `coverage.json` skips from 3.3 with its tool.
- Not planned in this change: thumbnails, HEIC, an offline upload queue, a quota UI, API write access. The email inbox is sc-2355; its server-added attachments use the unencrypted marking.
