# Tasks

Write each test first and see it fail before implementing. Name tests after the spec scenarios they cover. Use only synthetic test files and test budgets; never read Ken's real budget data.

## 1. Data model (sc-2346)

- [x] 1.1 Add the migration `packages/loot-core/migrations/<ts>_add_transaction_attachments.sql`, with an id that sorts above `1793400000000`, holding the `transaction_attachments` table from design decision 1, and add the table to the AQL schema including its `tombstone` field. Verify that the additive-migrations test and `yarn typecheck` pass, and that a test inserting a row through `db` and reading it back with `aqlQuery` succeeds.
  - Note: `transaction_id` has no `ref` to `transactions` in the AQL schema. With the ref, AQL joined through it and hid attachment rows in queries, so the column is a plain id.

## 2. Sync-server endpoints (sc-2346)

- [x] 2.1 Add the `attachments.fileSizeLimitMB` (10) and `attachments.budgetQuotaMB` (1024) config values with their env vars, and `attachments: { fileSizeLimitMB }` in `GET /info`. Verify with a test that `/info` returns 10 by default and 5 when the env var is set to 5.
- [x] 2.2 Add `src/util/attachments.ts` (magic-byte type check, HEIC detection) and the attachment path helper in `src/util/paths.ts`. Write failing unit tests first: PDF, JPEG, PNG and WebP headers accepted; text, DOCX and a text file named `.pdf` refused; HEIC reported as `heic`; an id like `../file-x` rejected. Verify they pass.
- [x] 2.3 Write failing tests in `app-sync.test.ts` named after the spec scenarios "Server checks too", "Quota reached", "No access", "Not signed in" and "Path in the id", plus: upload then download returns the same bytes; an encrypted upload of non-PDF bytes under the limit is stored; delete removes the blob. Also test that an upload with an existing attachment id overwrites the blob, and that an encrypted upload exactly at the limit is accepted while one byte more is refused. Implement `upload-attachment`, `download-attachment` and `delete-attachment` (design decision 2). Verify the tests pass.
  - Note: the endpoint tests live in `src/app-sync.attachments.test.ts`, not `app-sync.test.ts`. The "Not signed in" tests and the download-404 test passed as soon as they were written, since existing auth and file handling already gave those answers; they pin that behavior rather than drive the change.

## 3. Client handlers (sc-2346)

- [x] 3.1 Add `loot-core/src/shared/attachments.ts` (the same type check as 2.2) with unit tests over the same sample headers. Verify they pass.
- [x] 3.2 Write failing tests for `transaction-attachment-add`, `-open` and `-remove` against a test budget with the server calls mocked at the fetch boundary, named after "Attach a PDF", "Attach a second document", "Upload fails", "Oversize file", "Wrong type", "Renamed file", "HEIC photo", "Limit set by the server", "Local-only budget", "Encrypted budget", "Unencrypted budget", "Unencrypted attachment in an encrypted budget", "Opened before, now offline", "Never opened, offline", "Remove", "Undo a removal" and "Attach from a split line". Also test that a failed row write after a 200 upload calls `delete-attachment` once. Implement `server/attachments/app.ts` (design decisions 3 and 4). On the web build, copy the downloaded or encrypted bytes into their own buffer before writing them to the cache; don't cache the raw `encrypt()` output, whose buffer may be a view over a larger one. Verify the tests pass.
- [x] 3.3 Add `skip` entries for the three handlers to `packages/mcp/coverage.json` ("No MCP tool yet; the read tool is sc-2526"). Verify `yarn check:mcp-coverage` passes.

## 4. Transactions (sc-2346)

- [x] 4.1 Write failing tests in `transactions/merge.test.ts` for "Merge keeps both documents" and that one undo restores both transactions and their attachments. Move attachments to the kept id in `merge.ts` (design decision 5). Verify the tests pass.
  - Note: the one-undo test passed when first written; it pins existing undo behavior rather than driving the change.
- [x] 4.2 Write a failing test for "Delete and undo": deleting a transaction (and a split parent, covering its children) tombstones its attachment rows in the same batch, and one undo restores the transaction and the rows. Implement it in `batchUpdateTransactions` (design decision 5). Verify it passes.

- [x] 4.3 Write failing tests in `encryption/app.test.ts` (or next to `keyMake`) for "New key keeps documents readable" and "Re-encryption fails", with the server mocked at the fetch boundary: after `key-make`, each encrypted attachment's blob was re-uploaded under the same id and its row's `encrypt_meta` names the new key; an unencrypted attachment is untouched; on a refused re-upload `key-make` throws before `resetSync`, and every attachment decrypts with the old key. Implement design decision 8. Verify they pass.
  - Deviation: on a refused re-upload `key-make` returns `{ error: { reason: 'attachment-reencrypt-failed' } }` instead of throwing, matching how its other failures are reported to the client. It still stops before `resetSync`, and it rolls back by re-uploading each original ciphertext and restoring the old `encrypt_meta`, so every attachment still decrypts with the old key.

## 5. Desktop UI (sc-2346)

- [x] 5.1 Add "Attach document…" to `SelectedTransactionsButton.tsx` (one selected transaction only), the hidden file input, and the refusal and "needs a sync server" notifications, all translated. Verify with a component test for "Several transactions selected" and "Local-only budget", and by attaching a PDF on the demo budget with a local sync server (`yarn start:server-dev`).
  - Manual check (2026-11-05, Chrome, `yarn start:server-dev`, demo budget uploaded to the local server): attaching a synthetic PDF showed the paperclip and stored the blob under `user-files/attachments/<fileId>/`. A synthetic 11 MB file was refused with "larger than the 10 MB limit" and a `.txt` file with "Only PDF, JPEG, PNG and WebP".
- [x] 5.2 Add the register paperclip and its popover (list, Open, Remove), with split lines showing the parent's paperclip. Verify with a component test for "Indicator shown" and "No indicator", and in the running app.
  - Manual check: attaching from a split line stored the row on the parent id, and the parent and all its split lines showed the paperclip. Remove hid the paperclip and Cmd+Z brought it back, and the document still opened.
- [x] 5.3 Add the export notice to `settings/Export.tsx`. Verify "Export a budget with attachments" with a test that the exported zip holds only `db.sqlite` and `metadata.json`, and that the notice renders.
  - Note: the zip-contents test passed when first written, since export already wrote only `db.sqlite` and `metadata.json`; it guards against a later change adding attachments to the zip.
- [x] 5.4 Open a PDF and a PNG in the web build and in the Electron dev build. If Electron doesn't render the blob window, add the `shell.openPath` fallback from design decision 6. Verify both builds show the document.
  - Web: a synthetic PDF and PNG each opened in a new browser tab. Electron: the app denies every new window, so the `shell.openPath` fallback was built up front (an `open-attachment` IPC handler that writes the file to a private temp folder and opens it in the OS viewer; the file name's extension always comes from the checked type, unit-tested in `tests/external-links.test.ts`). The Electron dev build was not run by hand; the Tester's steps in 6.1 cover it. The temp copies are never deleted: sc-2528.
- [x] 5.5 Run `yarn generate:i18n`, `yarn typecheck`, `yarn lint:fix` and `yarn test`. Verify all pass.

## 6. Cross-device check (sc-2346)

- [x] 6.1 Test "Attached on one device, opened on another" against a local sync server (`yarn start:server-dev`) with two separate browser profiles signed in to the same budget: profile A attaches a PDF, profile B syncs, shows the paperclip and opens the same PDF. The web e2e suite has no sync server today, so this is a Tester-run check unless the Developer adds one; record the steps and result (screenshots of both profiles) on the PR. Verify the Tester's comment shows it passing.
  - Tester's steps:
    1. From the repo root, with Node 24.22.1, run `yarn start:server-dev` and wait for the web app on http://localhost:3001 and the sync server on http://localhost:5006.
    2. Profile A (a Chrome profile with no Actual data for localhost:3001): open http://localhost:3001, choose a server at `http://localhost:5006`, set a test password, sign in, then "Create test file". The test file starts with sync disabled; upload it from the browser console with `await window.$send('upload-budget', {})` and reload.
    3. In Profile A, open Bank of America, tick one transaction, open the "1 transactions" menu, choose "Attach document…" and pick a small synthetic PDF. Check the paperclip appears next to the payee. Screenshot.
    4. Profile B (a second, separate Chrome profile): open http://localhost:3001, choose the same server, sign in with the same password and open "Test Budget" from the file list.
    5. In Profile B, open Bank of America and find the same transaction. Check the paperclip is there, click it, click Open, and check the same PDF opens in a new tab. Screenshot.
    6. Electron: run `yarn start:desktop`, sign in to the same server, open the same budget, click the paperclip and Open. Check the PDF opens in the OS viewer (Preview on macOS). Screenshot.
    7. Post the result and the screenshots as a PR comment.
  - Result: passed, per the Tester's comment https://github.com/kenlefeb/actual/pull/219#issuecomment-6675534545 (checked at `0a46de984` and again at `223e1b485`). A PDF attached on device A showed its paperclip on device B, and Open showed the same PDF there. Deviations from the steps above:
    - The two devices were two origins (`localhost:3001` and `127.0.0.1:3001`) in one Chrome profile, not two Chrome profiles. Each origin has its own browser storage.
    - Chrome's file picker can't be automated, so after "Attach document…" the file was set on the hidden file input directly.
    - The Electron step (6) wasn't run. Opening in Electron is covered only by the `external-links` unit test.

## Workflow follow-up

- Release: bump the eight package versions to the next alpha, add fork release notes and regenerate the fork news, per AGENTS.md. No production change is needed beyond deploying the release.
- On archive: add `transaction-attachments` to epic 543's description, create the `spec:transaction-attachments` label, point sc-2346's change link at the archive path.
- Deferred items already have Backlog stories under epic 543: mobile attach and camera (sc-2523), export inclusion (sc-2524), orphaned-blob cleanup after 30 days, for tombstoned rows and for a deleted budget's attachments folder (sc-2525), MCP read tool for attachment metadata (sc-2526). sc-2526 replaces the `coverage.json` skips from 3.3 with its tool.
- Not planned in this change: thumbnails, HEIC, an offline upload queue, a quota UI, API write access. The email inbox is sc-2355; its server-added attachments use the unencrypted marking.
