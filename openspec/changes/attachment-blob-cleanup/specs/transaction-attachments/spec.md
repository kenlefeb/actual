## ADDED Requirements

### Requirement: Devices report removed documents
After a sync that follows a change to attachments, after a budget upload or restore, and after a budget's first sync in each app session, a device SHALL ask the server for the budget's recorded ids, then send as removed its removed ids not yet recorded and as live its live ids that are recorded, in batches. The server SHALL delete the record of a live id. A repeated report SHALL change nothing.

#### Scenario: Removal is recorded
- **WHEN** a device removes a document and syncs
- **THEN** the server holds a removal record for that document, dated that day

#### Scenario: Undo clears the record
- **GIVEN** a removal record for a document
- **WHEN** the user undoes the removal and the device syncs
- **THEN** the report lists it as live, and the server deletes the record

#### Scenario: A restored budget clears records
- **GIVEN** a document recorded as removed, and a budget restored to a state where it is live
- **WHEN** the restored budget is uploaded and synced
- **THEN** the report lists the document as live without any attachment change, and the record is deleted

#### Scenario: Only what the server needs
- **GIVEN** a budget with 20,000 live attachments and 3 recorded ids
- **WHEN** a device reports
- **THEN** it sends at most those 3 as live, and as removed only removed ids not yet recorded

#### Scenario: A client that never reports
- **WHEN** an older client removes a document and never reports
- **THEN** the server records nothing, and cleanup never deletes that document

### Requirement: Records only for stored documents
The server SHALL record a removed id only when that document is stored on the server, so an id whose document cleanup already deleted gets no new record, however often it is reported. `removalCount` SHALL count only records of stored documents.

#### Scenario: Already deleted
- **GIVEN** a removed attachment whose document cleanup deleted
- **WHEN** a device reports its removed ids again
- **THEN** the server creates no record for it, and nothing is deleted 30 days later

### Requirement: A report is checked
The server SHALL accept a report only from a user with access to the budget, and only when `removed` and `live` are each an array of at most 1000 strings, each a valid id of at most 64 characters. Any other report SHALL get a 400 and write nothing.

#### Scenario: Too many ids
- **WHEN** a report lists 1,001 removed ids
- **THEN** the server answers 400 and records nothing

#### Scenario: A bad id or type
- **WHEN** a report has an id of 65 characters, an id with a `/`, or a number in the array
- **THEN** the server answers 400 and records nothing, including the valid ids in the same report

#### Scenario: A user without access
- **WHEN** a user with no access to the budget sends a report for it
- **THEN** the server refuses it and records nothing

### Requirement: Orphaned after 30 days
The server SHALL treat a document as orphaned only when it holds a removal record at least 30 days old; the days SHALL be set by `attachments.orphanRetentionDays`, and 0 SHALL turn deletion off. A document with no record SHALL never be deleted by cleanup.

#### Scenario: Not yet old enough
- **GIVEN** a document whose removal record is 29 days old
- **WHEN** cleanup runs
- **THEN** the server still holds the document

#### Scenario: Old enough
- **GIVEN** a document whose removal record is 31 days old
- **WHEN** cleanup runs
- **THEN** the server deletes the document and its record

#### Scenario: Setting 0
- **GIVEN** `attachments.orphanRetentionDays` is 0
- **WHEN** cleanup runs
- **THEN** it deletes nothing

### Requirement: The retention setting is checked
`attachments.orphanRetentionDays` SHALL be a non-negative integer. The server SHALL refuse to start when the setting is negative, fractional or not a number, naming the setting, and SHALL never coerce it. 0 is the documented way to turn deletion off.

#### Scenario: A bad value
- **WHEN** the server starts with `ACTUAL_ATTACHMENTS_ORPHAN_RETENTION_DAYS` set to `-1`, `1.5` or `abc`
- **THEN** it refuses to start and names the setting, and deletes nothing

### Requirement: Use keeps a document
Downloading or uploading a document that has a removal record SHALL reset the record's time to now, so a device that fetches it keeps it. A device with a cached copy does not reach the server, so it is protected by its next sync, which brings the removal. Only a live report deletes a record, and a deletion SHALL re-check the record's age.

#### Scenario: A lagging device with no cached copy opens a removed document
- **GIVEN** a document whose removal record is 29 days old, still shown on a device that has not synced and holds no cached copy
- **WHEN** that device opens it
- **THEN** the record is dated now, and cleanup keeps the document for another 30 days

#### Scenario: A lagging device with a cached copy
- **GIVEN** the same document, cached on a device that has not synced
- **WHEN** that device syncs
- **THEN** it brings the removal and hides the document, and the cached copy is not a reason to keep the blob

#### Scenario: Opened during cleanup
- **WHEN** a download touches a record between cleanup choosing it and deleting it
- **THEN** cleanup sees the record is no longer old and keeps the document

### Requirement: A daily, bounded cleanup job
The server SHALL run cleanup one minute after it starts and then every 24 hours, one run at a time. A run SHALL delete at most 500 documents or deleted-budget folders, oldest record first. A missing file SHALL count as done and its record SHALL be deleted. A real failure SHALL be logged, SHALL not stop the run, and SHALL move that record's time to now so it is not picked ahead of newer records.

#### Scenario: A backlog
- **GIVEN** 1,200 orphaned documents
- **WHEN** a run completes
- **THEN** 500 are deleted, the oldest records first, and the rest wait for the next run

#### Scenario: A document already gone
- **GIVEN** 500 old records whose files are already missing, and one newer orphaned document
- **WHEN** two runs complete
- **THEN** the 500 records are deleted, and the newer document is deleted by the second run at the latest

#### Scenario: A document that can't be deleted
- **GIVEN** an orphaned document whose file can't be removed
- **WHEN** a run happens
- **THEN** the error is logged, the other orphaned documents are deleted, and the next run picks newer records before this one

### Requirement: Every deletion is logged
The server SHALL log each deletion at info level with the budget id and the attachment id, or the budget id for a folder, and the age in days. The documentation SHALL name `attachments.orphanRetentionDays` set to 0 as the switch that stops deletion at once.

#### Scenario: A deletion is logged
- **WHEN** cleanup deletes a document
- **THEN** the log has one line with its budget id, attachment id and age

### Requirement: A deleted budget's documents
When a budget is deleted on the server, the server SHALL record the time, and 30 days later cleanup SHALL remove the budget's whole documents folder. Resetting a budget's sync SHALL keep its documents. An upload under that id SHALL cancel the removal only when the uploader owns the deleted budget; otherwise the record stays.

#### Scenario: Budget deleted
- **GIVEN** a budget with documents, deleted on the server 31 days ago
- **WHEN** cleanup runs
- **THEN** the budget's documents folder is gone

#### Scenario: Owner uploads again
- **GIVEN** a budget deleted 10 days ago
- **WHEN** its owner uploads a budget under the same id
- **THEN** its documents are kept, and the deletion record is cleared

#### Scenario: Someone else uploads under the id
- **GIVEN** a budget deleted 10 days ago
- **WHEN** another user uploads a budget under the same id
- **THEN** the deletion record stays, and the old folder is still removed after 30 days

#### Scenario: Sync reset
- **WHEN** a budget's sync is reset
- **THEN** its documents and removal records are unchanged

### Requirement: Folder removal is confined
Before removing a folder, cleanup SHALL require a valid file id, build the path only with the server's attachments-folder helper, refuse any path not strictly inside `<userFiles>/attachments/`, delete the deletion record first with its age condition, remove the folder only if that deleted a row, and re-check the budget is still deleted.

#### Scenario: An invalid id
- **GIVEN** a deletion record whose file id is empty or `..`
- **WHEN** cleanup runs
- **THEN** it removes nothing, and logs the refusal

#### Scenario: Restored a moment before
- **GIVEN** a deletion record 31 days old, for a budget that is no longer deleted
- **WHEN** cleanup runs
- **THEN** the folder stays

### Requirement: Document disk use in the status output
The server's `/metrics` SHALL include an `attachments` block with the bytes of all stored documents, `removalBytes` and `removalCount` for those under a removal record, and the time, number deleted and result of the last cleanup, the result being only `ok`, `partial` or `error`. It SHALL name no budget or file.

#### Scenario: Status after cleanup
- **GIVEN** cleanup deleted 3 documents
- **WHEN** a client reads `/metrics`
- **THEN** the block shows the stored bytes, `removalBytes`, `removalCount`, and a last cleanup of 3 deleted with result `ok`

#### Scenario: A failed run
- **GIVEN** a run failed with an error whose message holds a file path
- **WHEN** a client reads `/metrics`
- **THEN** the result is `error`, and no message or path appears

### Requirement: The status walk is cheap
The `/metrics` document totals SHALL come from an asynchronous walk that concurrent requests share, and SHALL be cached for 60 seconds, a failed walk included. The request path SHALL never block on synchronous file calls.

#### Scenario: Many requests at once
- **WHEN** 50 requests read `/metrics` together
- **THEN** one walk runs, and all 50 get its result

## MODIFIED Requirements

### Requirement: Remove a document
The user SHALL be able to remove a document from a transaction. Removing it SHALL hide it on every device after sync, and undo SHALL restore it. The server SHALL keep the document until it is orphaned (see "Orphaned after 30 days").

#### Scenario: Remove
- **WHEN** the user removes the only document from a transaction
- **THEN** the paperclip disappears, and the document is still stored on the server

#### Scenario: Undo a removal
- **WHEN** the user removes a document and then undoes
- **THEN** the paperclip returns, and the document opens

### Requirement: Deleting a transaction
Deleting a transaction SHALL remove its attachments in the same change, the same way as removing them by hand: they're marked removed, one undo restores the transaction and its attachments, and the server keeps the documents until they are orphaned.

#### Scenario: Delete and undo
- **GIVEN** a transaction with two attachments
- **WHEN** the user deletes the transaction and then undoes
- **THEN** the transaction returns with both documents, and each opens

### Requirement: Remove a document on the phone
On the phone, Remove SHALL remove the document at once, without "Save changes", and SHALL show a notification with Undo. Undo SHALL restore the document. The server SHALL keep the document until it is orphaned.

#### Scenario: Remove on the phone
- **WHEN** the user taps Remove next to the only document of a transaction
- **THEN** the document leaves the list, the row's paperclip disappears, and the document is still stored on the server

#### Scenario: Undo a removal on the phone
- **WHEN** the user removes a document on the phone and taps Undo in the notification
- **THEN** the document is listed again, the paperclip returns, and the document opens
