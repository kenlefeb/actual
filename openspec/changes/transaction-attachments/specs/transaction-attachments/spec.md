# Spec Delta

## Purpose

Lets the user keep receipts and invoices with the transaction they belong to. A document is attached on desktop, stored on the sync server, and opens on every device that has the budget.

## ADDED Requirements

### Requirement: Attach a document to a transaction
On desktop, the transaction menu SHALL offer "Attach document…" when exactly one transaction is selected. Choosing a file SHALL attach it to that transaction. A transaction MAY have several documents. The attachment SHALL be recorded in the budget only after the server has stored the document, so no device sees an attachment whose document is missing.

#### Scenario: Attach a PDF
- **GIVEN** a budget that syncs with a sync server
- **WHEN** the user selects one transaction, chooses "Attach document…" and picks a 200 KB PDF
- **THEN** the transaction has one attachment with the file's name, type and size, and the server holds its document

#### Scenario: Attach a second document
- **GIVEN** a transaction with one attached PDF
- **WHEN** the user attaches a JPEG to it
- **THEN** the transaction lists both documents

#### Scenario: Several transactions selected
- **WHEN** the user selects two transactions and opens the transaction menu
- **THEN** "Attach document…" is not offered

#### Scenario: Upload fails
- **WHEN** the server refuses or doesn't answer the upload
- **THEN** the transaction gets no attachment, and the user sees a message that the document wasn't attached

### Requirement: Accepted types
The app SHALL accept only PDF, JPEG, PNG and WebP documents, identified by the file's content and not its name or extension. It SHALL refuse a HEIC image with a message saying HEIC isn't supported yet. A refusal SHALL say why and SHALL attach nothing.

#### Scenario: Wrong type
- **WHEN** the user picks a `.docx` file
- **THEN** it is refused with a message listing PDF, JPEG, PNG and WebP

#### Scenario: Renamed file
- **WHEN** the user picks a text file renamed to `receipt.pdf`
- **THEN** it is refused as an unsupported type

#### Scenario: HEIC photo
- **WHEN** the user picks a HEIC image
- **THEN** it is refused with a message that HEIC isn't supported yet

### Requirement: Per-file size limit
The app SHALL refuse a document larger than the server's per-file limit, 10 MB by default and set in the server's configuration. The refusal SHALL name the limit and SHALL attach nothing.

#### Scenario: Oversize file
- **WHEN** the user picks an 11 MB PDF with the default limit
- **THEN** it is refused with a message naming the 10 MB limit, and nothing is uploaded

#### Scenario: Limit set by the server
- **GIVEN** the server's per-file limit is set to 5 MB
- **WHEN** the user picks a 6 MB PNG
- **THEN** it is refused with a message naming the 5 MB limit

### Requirement: Checked on client and server
The client SHALL check type and size before uploading. The server SHALL check the size of every upload, and the type of every upload not marked encrypted, since it can't read an encrypted one. The server SHALL refuse and store nothing on failure.

#### Scenario: Server checks too
- **WHEN** a request uploads an 11 MB file directly to the server, or an upload marked unencrypted whose content isn't PDF, JPEG, PNG or WebP
- **THEN** the server refuses it and stores nothing

### Requirement: Per-budget quota
The server SHALL refuse an upload that would take the total size of the budget's stored documents past its quota, 1 GB by default and set in the server's configuration. Documents still stored for removed attachments SHALL count toward the total until the server deletes them.

#### Scenario: Quota reached
- **GIVEN** a budget whose stored documents total 1 GB minus 1 MB
- **WHEN** the user attaches a 2 MB PDF
- **THEN** the upload is refused with a message that the budget's document storage is full, and nothing is attached

### Requirement: Needs a sync server
A budget that doesn't sync with a sync server SHALL not allow attaching documents. "Attach document…" SHALL say it needs a sync server instead of opening a file picker.

#### Scenario: Local-only budget
- **GIVEN** a budget created with "Don't use a server"
- **WHEN** the user chooses "Attach document…" on a transaction
- **THEN** no file picker opens, and the user sees that attaching documents needs a sync server

### Requirement: Only the budget's users reach its documents
The server SHALL serve, store and delete a budget's documents only for a signed-in user with access to that budget, the same access the budget file itself requires. It SHALL reject an invalid budget or attachment id.

#### Scenario: No access
- **WHEN** a signed-in user without access to budget B asks for one of B's documents
- **THEN** the server refuses and returns no content

#### Scenario: Not signed in
- **WHEN** a request without a valid session asks to upload, download or delete a document
- **THEN** the server refuses it

#### Scenario: Path in the id
- **WHEN** a request names an attachment id such as `../file-x`
- **THEN** the server rejects it as an invalid id and touches no file

### Requirement: Encrypted with the budget key
When the budget has an encryption key, the client SHALL encrypt each document with that key before upload, and the server SHALL hold only ciphertext. Each attachment SHALL record whether its document is encrypted. An attachment marked unencrypted SHALL open without decryption, so documents the server adds itself can be attached to an encrypted budget.

#### Scenario: Encrypted budget
- **GIVEN** a budget with an encryption key
- **WHEN** the user attaches a PDF
- **THEN** the blob stored on the server is not the PDF's bytes, and opening the attachment shows the original PDF

#### Scenario: Unencrypted budget
- **GIVEN** a budget without an encryption key
- **WHEN** the user attaches a PDF
- **THEN** the attachment is marked unencrypted, and opening it shows the PDF

#### Scenario: Unencrypted attachment in an encrypted budget
- **GIVEN** a budget with an encryption key, and an attachment marked unencrypted whose stored blob is a plain PDF
- **WHEN** the user opens it
- **THEN** the PDF opens

### Requirement: Paperclip in the register
A transaction with at least one attachment SHALL show a paperclip in the desktop register. Choosing the paperclip SHALL list the transaction's documents by name, and offer to open or remove each one. A transaction without attachments SHALL show no paperclip.

#### Scenario: Indicator shown
- **WHEN** a transaction has one attachment
- **THEN** its register row shows a paperclip, and choosing it lists the document's name

#### Scenario: No indicator
- **WHEN** a transaction has no attachments, or all of its attachments were removed
- **THEN** its register row shows no paperclip

### Requirement: Open a document
Opening an attachment SHALL fetch its document from the server, decrypt it if it's encrypted, and show it in the browser's own viewer in a new tab. A document once fetched SHALL be kept on the device, so it opens again without the server.

#### Scenario: Open a PDF
- **WHEN** the user opens an attached PDF
- **THEN** it opens in a new tab with the same bytes that were attached

#### Scenario: Opened before, now offline
- **GIVEN** the user opened an attachment once on this device
- **WHEN** the server is unreachable and the user opens it again
- **THEN** it opens

#### Scenario: Never opened, offline
- **GIVEN** an attachment not yet opened on this device
- **WHEN** the server is unreachable and the user opens it
- **THEN** the user sees that the document can't be loaded right now

### Requirement: Available on every device
An attachment SHALL sync to every device that has the budget. Its document SHALL be fetched only when opened.

#### Scenario: Attached on one device, opened on another
- **GIVEN** device A and device B have the same synced budget
- **WHEN** the user attaches a PDF on device A, and device B syncs
- **THEN** device B shows the paperclip on that transaction, and opening it on device B shows the same PDF

### Requirement: Remove a document
The user SHALL be able to remove a document from a transaction. Removing it SHALL hide it on every device after sync, and undo SHALL restore it. The server SHALL keep the document after removal.

#### Scenario: Remove
- **WHEN** the user removes the only document from a transaction
- **THEN** the paperclip disappears, and the document is still stored on the server

#### Scenario: Undo a removal
- **WHEN** the user removes a document and then undoes
- **THEN** the paperclip returns, and the document opens

### Requirement: Split transactions
Documents SHALL attach to the parent of a split transaction. Attaching from a split line SHALL attach to its parent. Each line of a split SHALL show the parent's paperclip.

#### Scenario: Attach from a split line
- **WHEN** the user selects one line of a split and attaches a PDF
- **THEN** the PDF is attached to the parent, and the parent and every line show the paperclip

### Requirement: Deleting a transaction
Deleting a transaction SHALL remove its attachments in the same change, the same way as removing them by hand: they're marked removed, one undo restores the transaction and its attachments, and the server keeps the documents.

#### Scenario: Delete and undo
- **GIVEN** a transaction with two attachments
- **WHEN** the user deletes the transaction and then undoes
- **THEN** the transaction returns with both documents, and each opens

### Requirement: Changing the encryption key
When the user creates a new encryption key for a budget, every attachment encrypted with the old key SHALL be re-encrypted with the new key and stored again in place, before the key change completes, so no document becomes unreadable. Attachments marked unencrypted SHALL stay as they are. If any re-encryption fails, the key change SHALL stop with an error, the old key SHALL stay in effect, and every attachment SHALL still open.

#### Scenario: New key keeps documents readable
- **GIVEN** a budget with an encryption key and an attached PDF
- **WHEN** the user creates a new encryption key and then opens the attachment, on this device and on another device signed in with the new key
- **THEN** the PDF opens on both

#### Scenario: Re-encryption fails
- **GIVEN** a budget with an encryption key and two attached PDFs
- **WHEN** the user creates a new key and the server refuses the second re-upload
- **THEN** the key change fails with a message, the old key stays in effect, and both PDFs open

### Requirement: Merging transactions
Merging two transactions SHALL move every attachment of the dropped transaction to the kept one.

#### Scenario: Merge keeps both documents
- **GIVEN** transaction A with a receipt and transaction B with an invoice
- **WHEN** the user merges A and B
- **THEN** the remaining transaction lists both the receipt and the invoice

### Requirement: Budget export leaves documents out
The budget export SHALL not include attached documents, and SHALL tell the user that attached documents aren't included.

#### Scenario: Export a budget with attachments
- **GIVEN** a budget with attachments
- **WHEN** the user exports it
- **THEN** the exported file holds no document content, and the export tells the user attached documents aren't included
