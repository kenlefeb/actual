# Proposal

## Why

Transaction attachments (sc-2346) only work on a saved transaction. Ken wants to attach a receipt while adding a transaction, for example a photo taken at the register (sc-2622, Ken, 2026-11-06). The Explore (comment 3232) and the Product Owner's decisions (comment 3237) settled the design; this change specifies it. Implementation stories: sc-3234 (loot-core check), sc-3235 (phone), sc-3236 (desktop). sc-2640 (start a transaction from a receipt photo) builds on it.

## What Changes

- On desktop and on the phone, the add form lets the user pick documents before the transaction exists. The files are held on the device and checked when picked (type, size, sync server). Nothing is uploaded and nothing is stored on the server until the transaction has saved.
- After the save, each held document is attached to the saved transaction (the parent, for a split) with the existing attach. Cancelling or discarding the add leaves nothing behind, because nothing was sent.
- At most 5 documents per add; the limit is shown when reached.
- Picking is refused with the existing "check your connection" message when the app is offline. If the connection drops between picking and saving, the transaction is saved and the user is told the document was not attached.
- Desktop: a paperclip button with a count badge in the add row's action cluster next to Add, and a list of the held files under the row, each with Remove. The control is hidden for Schedule.
- Phone: the Documents section is offered on the add screen, with the same camera, Photos and Files paths, and a list of held files each with Remove.
- Undo is two steps: the add, then the attach.
- loot-core: a validate-only check handler (type by bytes, size limit, sync-server need; no upload) so the pick can be refused without uploading.
- Out of scope: how attachments behave on saved transactions; an offline upload queue (not filed unless Ken asks); previewing or opening a held file.

Mobile scope: `mobile/transactions/TransactionEdit.tsx` (add flow) and `mobile/transactions/TransactionAttachmentsSection.tsx`. Desktop scope: the add row in `transactions/TransactionsTable.tsx` and `transactions/TransactionAttachments.tsx`. No Ken-approved exception.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `transaction-attachments`: modifies "Attach a document to a transaction" (adds the add-row path) and "Attach a document on the phone" (drops the rule that a new transaction offers nothing); adds requirements for holding documents until save, saving them with the transaction, the per-add limit and offline behavior, and undo.

## Impact

- `loot-core`: one new validate-only handler beside `addAttachment` (`server/attachments/app.ts`), plus its `packages/mcp/coverage.json` line (tool or skip with a reason). The upload, row insert, encryption and server are unchanged.
- `desktop-client`: a shared pending-documents hook (accepts initial files, for sc-2640), the phone add screen and the register add row.
- No schema, sync or server change.
