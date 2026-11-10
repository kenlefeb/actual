## MODIFIED Requirements

### Requirement: Attach a document to a transaction
On desktop, the transaction menu SHALL offer "Attach document…" when exactly one transaction is selected. Choosing a file SHALL attach it to that transaction. A transaction MAY have several documents. The attachment SHALL be recorded in the budget only after the server has stored the document, so no device sees an attachment whose document is missing. The add row of the register SHALL also let the user pick documents for a transaction being added, as the requirement "Documents held while adding" describes.

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

## ADDED Requirements

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

### Requirement: Limit and offline while adding
A transaction being added SHALL hold at most 5 documents. At the limit the app SHALL say the limit has been reached and hold no more. While the app is offline, picking a document for a transaction being added SHALL be refused with the same "check your connection" message as a failed upload, and nothing SHALL be held. The user can save the transaction and attach later.

#### Scenario: Sixth document
- **GIVEN** a transaction being added with 5 held documents
- **WHEN** the user tries to attach a sixth
- **THEN** the user sees that the limit of 5 has been reached, and the sixth is not held

#### Scenario: Offline pick
- **WHEN** the app is offline and the user tries to attach a document while adding
- **THEN** it is refused with the message to check the connection, and nothing is held
