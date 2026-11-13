# Tasks

## 1. Server records and deletes orphans (sc-2525)

- [ ] 1.1 Tests first, failing: report inserts, keeps and clears records; a download and an upload restart the clock; the job deletes only records at least the retention age, respects the 500 limit and oldest-first, skips a failing file, and re-checks age at deletion; a deleted budget's folder goes after the retention period and an upload under the same id clears it; `0` disables deletion; `/metrics` shows the attachments block.
- [ ] 1.2 Migration for `attachment_removals` and `budget_removals`; the `/report-attachments` endpoint with the existing access check and id validation; touch on download and upload; the `delete-user-file` record.
- [ ] 1.3 The cleanup module started from `app.ts`, the `attachments.orphanRetentionDays` setting, and the `/metrics` block.
- [ ] 1.4 Document the setting and the metrics block in the sync-server README, and add a release note.

## 2. Clients report removals (sc-2525)

- [ ] 2.1 Tests first, failing: after a sync that followed an attachment change, loot-core posts the removed and live ids in batches of 1000; it posts nothing for a budget without a sync server; a failed report is dropped without an error shown and sent again after the next sync.
- [ ] 2.2 Send the report from loot-core's attachments app after sync, for desktop and phone alike, tolerating a server without the endpoint (404).
- [ ] 2.3 Check on a desktop and a phone build that a removal is recorded, an undo clears it, and a document still shown after the record is cleared opens.
