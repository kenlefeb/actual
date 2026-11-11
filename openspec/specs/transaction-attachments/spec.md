# transaction-attachments Specification

## Purpose
Lets the user keep receipts and invoices with the transaction they belong to. A document is attached on desktop or the phone, stored on the sync server, and opens on every device that has the budget.

## Requirements

### Requirement: Attach a document to a transaction
On desktop, the transaction menu SHALL offer "Attach document…" when exactly one transaction is selected. Choosing a file SHALL attach it to that transaction. A transaction MAY have several documents. The attachment SHALL be recorded in the budget only after the server has stored the document, so no device sees an attachment whose document is missing. The add row is covered by "Documents held while adding".

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
The app SHALL accept only PDF, JPEG, PNG and WebP documents, identified by the file's content and not its name or extension. It SHALL refuse a HEIC image with a message saying HEIC isn't supported yet and telling the user to pick the photo from the Photos library or save it as JPEG or PNG. A refusal SHALL say why and SHALL attach nothing.

#### Scenario: Wrong type
- **WHEN** the user picks a `.docx` file
- **THEN** it is refused with a message listing PDF, JPEG, PNG and WebP

#### Scenario: Renamed file
- **WHEN** the user picks a text file renamed to `receipt.pdf`
- **THEN** it is refused as an unsupported type

#### Scenario: HEIC photo
- **WHEN** the user picks a HEIC image
- **THEN** it is refused with a message that HEIC isn't supported yet, which tells the user to pick the photo from the Photos library or save it as JPEG or PNG

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

### Requirement: Attach a document on the phone
The mobile transaction edit screen SHALL offer "Attach document", for a saved transaction and for a transaction being added. It SHALL open the phone's own picker, which offers files, the camera and the photo library. On a saved transaction it SHALL attach the chosen document under the same rules as desktop, taking effect at once, without "Save changes". On a transaction being added it SHALL hold the document as the requirement "Documents held while adding" describes.

#### Scenario: Attach a PDF from Files on the phone
- **GIVEN** a budget that syncs with a sync server, on the mobile transaction edit screen of a saved transaction
- **WHEN** the user taps "Attach document" and picks a 200 KB PDF from Files
- **THEN** the Documents section lists the PDF's name, and the server holds its document

#### Scenario: Take a photo on the phone
- **WHEN** the user taps "Attach document", chooses the camera and takes a photo on an iPhone
- **THEN** the photo is attached as a JPEG image

#### Scenario: Choose from Photos on the phone
- **WHEN** the user taps "Attach document" and picks a picture from the Photos library on an iPhone, including one the camera stored as HEIC
- **THEN** the picture is attached as a JPEG image

#### Scenario: Attach a second document on the phone
- **GIVEN** a transaction with one attached PDF
- **WHEN** the user attaches a JPEG to it on the phone
- **THEN** the Documents section lists both documents

#### Scenario: Attach without saving on the phone
- **WHEN** the user attaches a PDF on the edit screen of a saved transaction and then leaves it with the back button, without "Save changes"
- **THEN** the PDF stays attached

#### Scenario: New transaction on the phone
- **WHEN** the user is adding a new transaction on the phone
- **THEN** "Attach document" is offered, and a document picked is held until the transaction is saved

#### Scenario: Upload fails on the phone
- **WHEN** the phone has no connection, or the server refuses or doesn't answer the upload
- **THEN** the transaction gets no attachment, and the user sees the same message as on desktop that the document wasn't attached

#### Scenario: Attach on a split transaction on the phone
- **GIVEN** a split transaction
- **WHEN** the user opens one of its lines from the transaction list and attaches a PDF on the edit screen
- **THEN** the PDF is attached to the parent, and the parent and every line show the paperclip in the list

### Requirement: Refusals on the phone
On the phone, every refusal SHALL attach nothing and SHALL show the same message as on desktop: unsupported type (by content), too large (naming the server's limit), HEIC, storage full, and needs a sync server.

#### Scenario: Wrong type on the phone
- **WHEN** the user picks a `.docx` file, or a text file renamed to `receipt.pdf`, on the phone
- **THEN** it is refused with a message listing PDF, JPEG, PNG and WebP

#### Scenario: Oversize file on the phone
- **WHEN** the user picks an 11 MB PDF on the phone with the default limit
- **THEN** it is refused with a message naming the 10 MB limit, and nothing is uploaded

#### Scenario: Quota reached on the phone
- **GIVEN** a budget whose stored documents total 1 GB minus 1 MB
- **WHEN** the user attaches a 2 MB PDF on the phone
- **THEN** it is refused with a message that the budget's document storage is full

#### Scenario: HEIC from the Files app
- **WHEN** the user picks a HEIC file from the Files app on an iPhone
- **THEN** it is refused with the HEIC message, which tells the user to pick the photo from the Photos library or save it as JPEG or PNG

#### Scenario: Local-only budget on the phone
- **GIVEN** a budget created with "Don't use a server"
- **WHEN** the user taps "Attach document" on the phone
- **THEN** no picker opens, and the user sees that attaching documents needs a sync server

### Requirement: Paperclip on phone transaction rows
A transaction with at least one attachment SHALL show a paperclip on its row in the mobile transaction list. Each line of a split SHALL show the parent's paperclip. A transaction without attachments SHALL show none. Tapping the row SHALL still open the edit screen.

#### Scenario: Paperclip on a phone row
- **WHEN** a transaction has one attachment
- **THEN** its row in the mobile transaction list shows a paperclip

#### Scenario: No paperclip on a phone row
- **WHEN** a transaction has no attachments, or all of its attachments were removed
- **THEN** its row in the mobile transaction list shows no paperclip

#### Scenario: Attached on desktop, seen on the phone
- **GIVEN** a phone and a desktop with the same synced budget
- **WHEN** the user attaches a PDF on desktop, and the phone syncs
- **THEN** the phone's row shows the paperclip, and the PDF opens from the phone's edit screen

### Requirement: Documents on the phone edit screen
The mobile edit screen of a saved transaction SHALL list the transaction's documents by name, each with Open and Remove. For a split transaction it SHALL list the parent's documents.

#### Scenario: List documents on the phone
- **GIVEN** a transaction with a PDF and a JPEG attached
- **WHEN** the user opens it on the phone
- **THEN** the Documents section lists both names, each with Open and Remove

### Requirement: Open a document on the phone
On the phone, Open SHALL show the document inside the app: an image as a picture and a PDF in a document view, with a button to share or save the file. It SHALL fetch, decrypt and cache the document as desktop does.

#### Scenario: Open a PDF on the phone
- **WHEN** the user taps Open next to an attached PDF on the phone
- **THEN** the app shows the PDF with the same bytes that were attached, and offers to share or save it

#### Scenario: Open a photo on the phone
- **WHEN** the user taps Open next to an attached JPEG on the phone
- **THEN** the app shows the picture

#### Scenario: Opened before, now offline on the phone
- **GIVEN** the user opened an attachment once on this phone
- **WHEN** the phone is offline and the user opens it again
- **THEN** it opens

#### Scenario: Never opened, offline on the phone
- **GIVEN** an attachment not yet opened on this phone
- **WHEN** the phone is offline and the user opens it
- **THEN** the user sees that the document can't be loaded right now

### Requirement: Remove a document on the phone
On the phone, Remove SHALL remove the document at once, without "Save changes", and SHALL show a notification with Undo. Undo SHALL restore the document. The server SHALL keep the document.

#### Scenario: Remove on the phone
- **WHEN** the user taps Remove next to the only document of a transaction
- **THEN** the document leaves the list, the row's paperclip disappears, and the document is still stored on the server

#### Scenario: Undo a removal on the phone
- **WHEN** the user removes a document on the phone and taps Undo in the notification
- **THEN** the document is listed again, the paperclip returns, and the document opens

### Requirement: Documents held while adding
While a transaction is being added, on desktop in the register's add row and on the phone on the add screen, the user SHALL be able to pick documents for it. Each picked document SHALL be checked when picked, by the same rules as a saved transaction (type by content, size limit, needs a sync server), and a refusal SHALL hold nothing and show the same message. A document that passes SHALL be held on the device, listed by name with Remove, and SHALL not be uploaded or stored on the server.

#### Scenario: Pick a document while adding on desktop
- **GIVEN** a budget that syncs with a sync server
- **WHEN** the user chooses the paperclip in the add row and picks a 200 KB PDF
- **THEN** the paperclip shows a count of 1, the PDF's name is listed under the row with Remove, and the server holds nothing for it

#### Scenario: Pick a document while adding on the phone
- **GIVEN** a budget that syncs with a sync server, on the add screen
- **WHEN** the user taps "Attach document" and picks a 200 KB PDF from Files, or takes a photo with the camera
- **THEN** the Documents section lists the file's name with Remove, and the server holds nothing for it

#### Scenario: Remove a held document
- **GIVEN** a transaction being added with one held document
- **WHEN** the user taps Remove next to it
- **THEN** it leaves the list, the count goes down, and nothing was sent to the server

#### Scenario: Refused when picked
- **WHEN** the user picks a `.docx` file, or an 11 MB PDF with the default limit, while adding
- **THEN** it is refused with the same message as on a saved transaction, and nothing is held

#### Scenario: Local-only budget while adding
- **GIVEN** a budget created with "Don't use a server"
- **WHEN** the user tries to attach a document while adding
- **THEN** no picker opens, and the user sees that attaching documents needs a sync server

#### Scenario: Split while adding
- **GIVEN** a transaction being added that the user splits into two lines, with one held document
- **WHEN** the user saves
- **THEN** the document is attached to the parent, and the parent and both lines show the paperclip

### Requirement: Controls for held documents
The list of held documents SHALL offer Remove only. On desktop the add row SHALL show the paperclip in its action cluster next to Add, with the count of held documents once there are any, and SHALL hide it when the user is adding a schedule. On the phone the Documents section SHALL stay on the form of the transaction, not on a split line.

#### Scenario: Count badge
- **GIVEN** a transaction being added in the desktop add row with two held documents
- **WHEN** the user looks at the add row
- **THEN** the paperclip shows a count of 2 and the two names are listed under the row, each with Remove only

#### Scenario: Schedule has no paperclip
- **WHEN** the user is adding a schedule in the desktop add row
- **THEN** the add row shows no paperclip

#### Scenario: Schedule with held documents
- **GIVEN** a transaction being added in the desktop add row with a held document, and a date for which the row offers Schedule
- **WHEN** the user looks at the add row
- **THEN** the paperclip is hidden, the held document stays listed with Remove, and the row says documents are attached when the user chooses Add and that Schedule does not keep them; Add attaches the document and Schedule never does

### Requirement: Held documents attach when the transaction saves
When the transaction being added is saved, the app SHALL attach each held document to the saved transaction (the parent, for a split) by the same attach as for a saved transaction, and SHALL then clear the held documents. A failure to attach one document SHALL not undo the save and SHALL not stop the others, and the user SHALL see a message naming the documents that weren't attached.

#### Scenario: Add with a document on desktop
- **GIVEN** a transaction being added with one held PDF
- **WHEN** the user chooses Add
- **THEN** the transaction is saved with the PDF attached and its paperclip, the server holds the document, and the add row is empty for the next entry, with no held documents

#### Scenario: Add with a document on the phone
- **GIVEN** a transaction being added on the phone with one held photo
- **WHEN** the user saves
- **THEN** the screen closes, and the saved transaction has the photo attached and shows its paperclip

#### Scenario: Connection lost between pick and save
- **GIVEN** a transaction being added with one held PDF
- **WHEN** the connection is lost and the user saves
- **THEN** the transaction is saved without the PDF, and the user sees a message that the document wasn't attached

#### Scenario: One document fails
- **GIVEN** a transaction being added with two held documents, and the server refuses the first upload
- **WHEN** the user saves
- **THEN** the transaction is saved with the second document attached, and the user sees a message naming the first as not attached

### Requirement: Cancelling and undoing an add with documents
Cancelling or discarding the add, closing the add row, or leaving the add screen without saving SHALL drop the held documents, and SHALL leave nothing stored on the server. After a save with documents, undo SHALL take two steps: the first removes the attachments, the second removes the transaction.

#### Scenario: Cancel while adding
- **GIVEN** a transaction being added with two held documents
- **WHEN** the user cancels the add on desktop, or discards it or leaves the add screen with the back button on the phone
- **THEN** no transaction is saved, and the server holds no document for them

#### Scenario: Undo after adding with a document
- **GIVEN** a transaction added with one attached document
- **WHEN** the user undoes once, then again
- **THEN** the first undo removes the attachment and keeps the transaction, and the second removes the transaction

#### Scenario: Undo after adding with two documents
- **GIVEN** a transaction added with two attached documents
- **WHEN** the user undoes once, then again
- **THEN** the first undo removes both attachments and keeps the transaction, and the second removes the transaction

### Requirement: Limit and offline while adding
A transaction being added SHALL hold at most 5 documents. At the limit the app SHALL say the limit has been reached and hold no more. While the app is offline, picking a document for a transaction being added SHALL be refused with the same "check your connection" message as a failed upload, and nothing SHALL be held. The user can save the transaction and attach later.

#### Scenario: Sixth document
- **GIVEN** a transaction being added with 5 held documents
- **WHEN** the user tries to attach a sixth
- **THEN** the user sees that the limit of 5 has been reached, and the sixth is not held

#### Scenario: Offline pick
- **WHEN** the app is offline and the user tries to attach a document while adding
- **THEN** it is refused with the message to check the connection, and nothing is held
