# Proposal

## Why

Shortcut sc-2538 (epic 543), from the Solution Architect's review of PR #219 (sc-2346). Two gaps remain in the attachment paths: a document whose blob is gone from the server (404) makes every key change fail with a misleading connection message, and a cached copy that was encrypted under a key another device has since replaced makes the document fail to open forever.

## What Changes

- Changing the key skips an attachment whose document the server no longer holds (404), logs its id, and still completes. Any other failure still stops the key change and keeps the old key.
- Opening an attachment whose cached copy no longer decrypts drops that copy and downloads the document once more.
- sc-3371 (folded in): a stale cached copy no longer blocks a key change; one shared helper serves open and key change.
- sc-3380 (folded in): a 404 skips a document only when it is the sync server's `attachment-not-found`; the sync server's `/download-attachment` sends that only for a missing file (ENOENT) and 500 for any other file error.
- Part 3 of the story (an `IN (...)` list over transaction ids) needs no change: no attachment code builds one (checked by search of `packages/loot-core/src/server/attachments/`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-attachments`: modifies "Open a document" and "Changing the encryption key".
