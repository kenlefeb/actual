# Proposal

## Why

Slice 1 of transaction attachments (sc-2346) tombstones attachment metadata when a document is removed or its transaction is deleted, but the sync server keeps every blob forever, and a deleted budget leaves its `attachments/<fileId>/` folder behind. Disk use only grows, and the per-budget quota counts removed documents. Story sc-2525 adds the cleanup, after a retention period long enough that sync lag cannot cost a user a document they still see.

## What Changes

- The server cannot read attachment metadata: it lives in the budget's sync messages, which the server stores as opaque (often encrypted) bytes. So the clients report removal: after a sync, a device sends the ids of its removed and its live attachments, and the server keeps a dated removal record per removed document.
- A document is orphaned when its removal record is 30 days old. Any download or upload of it restarts the clock, and a "live" report from any device clears the record.
- A daily server job deletes orphaned documents, at most 500 per run, re-checking each record at the moment of deletion.
- A budget deleted on the server has its whole `attachments/<fileId>/` folder removed 30 days after the deletion, by the same job.
- `/metrics` gains an `attachments` block: bytes stored, bytes under a removal record, documents waiting, and the last cleanup's time and result.
- A server setting, `attachments.orphanRetentionDays` (default 30, 0 turns deletion off).

Mobile scope: no screen changes. The report runs in loot-core, which the desktop and phone UIs share, so both report.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-attachments`: removal no longer keeps the document forever; adds the report, the retention rule, the cleanup job, deleted budgets and the status line.

## Impact

`packages/sync-server` (a migration for two account-db tables, `app-sync.ts`, a new cleanup module started from `app.ts`, `/metrics`, `load-config.js`) and `packages/loot-core/src/server/attachments` (the report). Old clients never report, so their removals are never cleaned up; that is the safe failure.
