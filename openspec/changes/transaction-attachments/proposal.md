# Proposal

## Why

A receipt or invoice can't be kept with the transaction it belongs to. Today a transaction carries only a note, which can hold a link but not the document itself (sc-2346). Every later step of "email a receipt and have it matched" (sc-2355, sc-2373) needs a place to put the document. This is slice 1: attach, see, open and remove documents on desktop.

## What Changes

- A user can attach one or more documents (PDF, JPEG, PNG or WebP) to a transaction from the desktop transaction menu ("Attach document…").
- A transaction with documents shows a paperclip in the register. The paperclip lists the documents, opens one, and removes one.
- Documents are stored on the sync server, one blob per document, and fetched only when opened. Their metadata syncs to every device through the budget, so a document attached on one device opens on another.
- When the budget has an encryption key, the client encrypts each document with it before upload; the server holds only ciphertext. An attachment can be marked unencrypted, for documents the server adds later (email intake, sc-2355).
- Files over 10 MB (a server setting), of another type (checked by content, not extension, on client and server), HEIC images, and uploads past the 1 GB per-budget quota are refused with a clear message.
- Creating a new encryption key re-encrypts the budget's encrypted documents under the new key before the change completes, so none becomes unreadable.
- Split transactions: documents attach to the parent; its lines show the parent's paperclip.
- Removing a document, or deleting its transaction, is a soft delete: undo restores it and the blob stays on the server.
- Merging two transactions keeps the documents of both on the kept one.
- Budgets without a sync server can't attach documents and say "needs a sync server".
- The budget export leaves documents out and says so.
- Out of scope for slice 1: mobile and camera (sc-2523), export inclusion (sc-2524), server cleanup of orphaned blobs (sc-2525), an MCP read tool (sc-2526), API write access, thumbnails, HEIC, an offline upload queue, the email inbox, and a quota UI.

## Capabilities

### New Capabilities
- `transaction-attachments`: Attaching documents to transactions: storage on the sync server, type and size limits, encryption, the register indicator, opening and removing documents, and how attachments follow splits, deletes, merges and export.

### Modified Capabilities
- none. Splits (`split-transaction-editing`) and notes (`transaction-notes`) keep their behavior.

## Impact

- `loot-core`: a migration adding the `transaction_attachments` table (synced like any other table), its AQL schema, handlers to attach, list, open and remove, encryption with the budget key, attachment carry-over in `transactions/merge.ts`, tombstoning with a deleted transaction, re-encryption in `key-make`, and a notice in the budget export.
- `sync-server`: three endpoints (upload, which may overwrite an existing document; download; delete) under the existing file-access checks, blob storage under `user-files/attachments/<budgetFileId>/`, and two config values (per-file limit, per-budget quota).
- `desktop-client`: "Attach document…" in the transaction menu, the register paperclip and its popover.
- `packages/mcp`: each new handler needs an entry in `coverage.json` (a `skip` until sc-2526 adds the read tool), or `yarn check:mcp-coverage` fails in Fork CI.
- No new dependency. No production change: no hosting, config or secret change is needed to deploy it; the defaults apply and the existing data-volume backup already captures the blobs.
