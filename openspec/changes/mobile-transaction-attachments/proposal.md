# Proposal

## Why

Every user-facing feature ships on desktop and on the phone (Ken, 2026-11-05). The `transaction-attachments` change (sc-2346) attaches, lists, opens and removes transaction documents on the desktop register only. The phone has its own transaction screens, and it's where receipts get photographed, so it needs the same feature there (sc-2523).

## What Changes

- The mobile transaction edit screen gains a Documents section for a saved transaction: "Attach document", and each attached document's name with Open and Remove.
- "Attach document" opens the phone's own picker, which offers Files, the camera and the Photos library. It accepts PDF, JPEG, PNG and WebP only, listed by type, so iOS hands a Photos or camera picture over as JPEG.
- A mobile transaction row shows a paperclip when the transaction has documents. Split lines show the parent's paperclip.
- Open shows the document inside the app (image or PDF), with a button to share or save it. It doesn't rely on a new browser tab, which iOS home-screen apps can't open for a document held in memory.
- Remove shows an Undo notification; Undo restores the document.
- Every refusal from desktop applies on the phone with the same wording: too large, unsupported type, HEIC, quota full, needs a sync server, upload failed. The HEIC message changes on both platforms to point to the Photos library or a JPEG/PNG copy.
- Offline behavior matches desktop: a document opened before opens again; one never opened says it can't be loaded right now; attaching needs a connection.
- Attaching and removing take effect at once, like deleting a transaction; they don't wait for "Save changes".
- Out of scope: export inclusion (sc-2524), blob cleanup (sc-2525), MCP read tool (sc-2526), an in-app camera, scanning or cropping, thumbnails, HEIC conversion and an offline upload queue.

Mobile scope: `mobile/transactions/TransactionEdit.tsx` (Documents section), `mobile/transactions/TransactionListItem.tsx` and `TransactionList.tsx` (row paperclip), and a new document viewer modal.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `transaction-attachments`: adds the phone requirements (attach from files, camera or Photos; row paperclip; document list, open, remove and undo; refusals; offline) and changes the HEIC refusal message on both platforms.

## Impact

- `desktop-client` only. The loot-core handlers (`transaction-attachment-add`, `-open`, `-remove`), the sync-server endpoints, the limits and the encryption from sc-2346 are reused unchanged. No migration, server or config change.
- Reuses `components/transactions/TransactionAttachments.tsx` from PR 219 (`AttachmentsProvider`, `useTransactionAttachments`, `useAttachDocument`, the refusal messages). Its HEIC string changes.
- New: a mobile Documents section component, a document viewer modal, a mobile e2e test with a local sync server started by the test.
- Depends on sc-2346 (PR 219) being merged first. No production change beyond deploying the release.
