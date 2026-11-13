# Design

## Context

Blobs are stored at `user-files/attachments/<fileId>/<attachmentId>.blob`, one per attachment, ciphertext when the budget has a key. The server never sees an attachment's row: `transaction_attachments` is client-side data that reaches the server only as sync messages, opaque and possibly encrypted. Today nothing on the server says which blobs are removed. Removing an attachment, deleting its transaction or merging transactions only writes a tombstone on the client, and the blob is never touched. `delete-user-file` only sets `files.deleted`; `reset-user-file` clears the group id and keeps the folder, because the budget is re-uploaded under the same id.

## Decisions

### 1. Clients report; the server does not infer
Two other ways were rejected. Reading tombstones on the server is impossible with encryption. Aging blobs by file time would delete a live receipt attached long ago. So after a sync completes (and after a budget upload or restore, and after a budget's first sync in each app session, so a restored budget clears records without any attachment change), a device first asks `/attachment-records` for the budget's recorded ids, which is bounded by what is waiting and not by budget size, paged at 1000 ids, behind the same checks as the other attachment endpoints and returning ids only, then posts `{fileId, removed: [ids], live: [ids]}`, with `removed` only the ids not yet recorded and `live` only the live ids that are recorded (each array at most 1000 strings, each a valid id of at most 64 characters; anything else is a 400 that writes nothing; repeated for more) to `/report-attachments`, under the same access check as the other attachment endpoints. Because the client's tombstoned rows are never purged, the same removed ids come up in every report; the server therefore records a removed id only when its blob is still stored, so cleanup's own deletions are not re-recorded and `removalCount` falls. The report is derived from state, not an event, so it is idempotent and needs no client memory, offline queue or undo hook: a removal by hand, a transaction delete and a merge all show up as tombstoned rows.

### 2. Two small account-db tables
`attachment_removals(file_id, attachment_id, marked_at)` and `budget_removals(file_id, marked_at)`, times in epoch milliseconds, in one migration. A `removed` id with no record gets one with `marked_at = now`; an existing record is untouched. A `live` id deletes its record.

### 3. Retention rule
Orphaned means: a record exists and `marked_at` is at least `orphanRetentionDays` (30) ago. A document with no record is never deleted, so a client that does not report, an upload whose metadata is mid-write, and a never-reported removal all keep their blob. 30 days is far beyond any realistic sync lag while keeping disk growth modest; it is a setting, a non-negative integer checked when the config loads (a negative value would make every record old, so it is refused, never coerced). `0` is the documented kill switch.

### 4. The risk: deleting a blob something still references
Ways it could happen, and the guard for each:
- Device B restores an attachment (undo) that device A already reported removed: B's next report says it is live and clears the record. A reports only after its own sync, which pulls B's restore first, so A reports it live too.
- A device lags or is offline for weeks and still shows the attachment: opening it downloads the blob, which restarts the clock. A device with a cached copy never reaches the server, and the cache is neither a protection nor a reason to keep the blob: its protection is that its next sync brings the removal and hides the document. Only a device that neither syncs nor fetches it for 30 days is exposed.
- A race between the job and a download: the job deletes the record row first with a condition on its age, and removes the file only if that deleted a row. A download that touched the record a moment earlier wins; one a moment later gets 404 `attachment-not-found`, the answer clients already treat as "document gone" without breaking the transaction.
- Re-encryption on a key change uploads removed documents too; an upload restarts the clock like a download, so a rotation delays cleanup by up to 30 days and never speeds it.
- An old client that never reports and never refreshes: its removals are never recorded, so nothing is deleted on its account; its live view is not protected by a live report, so it leans on the 30 days and the 404 behaviour.

Residual risk, accepted: a restore that no device syncs again within 30 days. The loss is one document, and the client already degrades gracefully when one is gone.

### 5. The job
A module started from `app.ts` after the server listens: first run one minute after start, then every 24 hours, on an unref'd timer, with an in-process flag so runs never overlap. Each run handles at most 500 deletions, oldest record first, budget deletions included. A run is a few indexed queries and file removals, so it needs no scheduler or queue. A missing file counts as done and its record is deleted. A real failure is logged and its record's time moves to now, so it is retried after a full retention period and never starves newer records. Every deletion is logged at info level (budget id, attachment id, age). Nothing throws out of the timer.

### 6. Deleted budgets
`delete-user-file` inserts a `budget_removals` row. After the retention period the job removes the whole `attachments/<fileId>/` folder and the row. `upload-user-file` for that id clears the row only when the uploader owns the deleted budget; otherwise the row stays, so another user cannot adopt the old folder. The removal is confined: the job requires `isValidFileId`, builds the path only with `getPathForAttachmentsDir`, refuses a path not strictly inside `<userFiles>/attachments/`, deletes the row first with its age condition, runs `rm` only if that deleted a row, and re-checks `files.deleted`. `reset-user-file` does neither, because the budget is about to be re-uploaded.

### 7. Status line
`/metrics` is the server's status output: unauthenticated, process-level, already holding memory and uptime. It gains `attachments: { bytes, removalBytes, removalCount, lastCleanup: { at, deleted, result } }`, totals only, no budget ids or names. Bytes come from an asynchronous, single-flight directory walk cached for 60 seconds, errors included, so unauthenticated requests cannot multiply disk work. `lastCleanup.result` is only `ok`, `partial` or `error`; it never carries a message or path. Per-budget usage stays out: the per-budget quota already reports its own refusals.

### 8. Not in this change
Quota relief for removed documents (they count until deleted, as the spec says), restoring a deleted budget's documents, a per-budget usage view, and a way to purge early. Production hardening is deferred.
