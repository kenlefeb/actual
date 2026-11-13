## ADDED Requirements

### Requirement: Devices report removed documents
After a sync that follows a change to attachments, a device SHALL send the server the ids of its removed attachments and of its live ones, in batches. The server SHALL record each removed id it has no record for, with the time it first heard of it, and SHALL delete the record of a live id. A repeated report SHALL change nothing.

#### Scenario: Removal is recorded
- **WHEN** a device removes a document and syncs
- **THEN** the server holds a removal record for that document, dated that day

#### Scenario: Undo clears the record
- **GIVEN** a removal record for a document
- **WHEN** the user undoes the removal and the device syncs
- **THEN** the report lists it as live, and the server deletes the record

#### Scenario: A client that never reports
- **WHEN** an older client removes a document and never reports
- **THEN** the server records nothing, and cleanup never deletes that document

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

### Requirement: Use keeps a document
Downloading or uploading a document that has a removal record SHALL reset the record's time to now, so a device still showing the attachment keeps it. Only a report that the attachment is live SHALL delete the record, and a deletion SHALL re-check the record's age at the moment it deletes.

#### Scenario: A lagging device opens a removed document
- **GIVEN** a document whose removal record is 29 days old, still shown on a device that has not synced
- **WHEN** that device opens it
- **THEN** the record is dated now, and cleanup keeps the document for another 30 days

#### Scenario: Opened during cleanup
- **WHEN** a download touches a record between cleanup choosing it and deleting it
- **THEN** cleanup sees the record is no longer old and keeps the document

### Requirement: A daily, bounded cleanup job
The server SHALL run cleanup one minute after it starts and then every 24 hours, one run at a time. A run SHALL delete at most 500 documents or deleted-budget folders, oldest record first. A failure on one SHALL be logged and skipped, and SHALL not stop the run or the server.

#### Scenario: A backlog
- **GIVEN** 1,200 orphaned documents
- **WHEN** a run completes
- **THEN** 500 are deleted, the oldest records first, and the rest wait for the next run

#### Scenario: A document that can't be deleted
- **GIVEN** one orphaned document whose file can't be removed
- **WHEN** a run happens
- **THEN** the error is logged and the other orphaned documents are deleted

### Requirement: A deleted budget's documents
When a budget is deleted on the server, the server SHALL record the time, and 30 days later cleanup SHALL remove the budget's whole documents folder. Uploading a budget under the same id SHALL cancel that. Resetting a budget's sync SHALL keep its documents.

#### Scenario: Budget deleted
- **GIVEN** a budget with documents, deleted on the server 31 days ago
- **WHEN** cleanup runs
- **THEN** the budget's documents folder is gone

#### Scenario: Budget uploaded again
- **GIVEN** a budget deleted 10 days ago
- **WHEN** a budget is uploaded under the same id
- **THEN** its documents are kept, and the deletion record is cleared

#### Scenario: Sync reset
- **WHEN** a budget's sync is reset
- **THEN** its documents and removal records are unchanged

### Requirement: Document disk use in the status output
The server's `/metrics` SHALL include an `attachments` block with the bytes of all stored documents, the bytes and count of those under a removal record, and the time, number deleted and result of the last cleanup. It SHALL name no budget or file.

#### Scenario: Status after cleanup
- **GIVEN** cleanup deleted 3 documents
- **WHEN** a client reads `/metrics`
- **THEN** the block shows the stored bytes, the removal bytes and count, and a last cleanup with 3 deleted

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
