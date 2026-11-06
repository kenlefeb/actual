# Spec Delta

## ADDED Requirements

### Requirement: Attach a document on the phone
The mobile transaction edit screen of a saved transaction SHALL offer "Attach document". It SHALL open the phone's own picker, which offers files, the camera and the photo library, and SHALL attach the chosen document to that transaction under the same rules as desktop. Attaching SHALL take effect at once, without "Save changes". A transaction not yet saved SHALL not offer it.

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
- **WHEN** the user attaches a PDF on the edit screen and then leaves it with the back button, without "Save changes"
- **THEN** the PDF stays attached

#### Scenario: New transaction on the phone
- **WHEN** the user is adding a new transaction on the phone
- **THEN** no "Attach document" is offered until the transaction is saved

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

## MODIFIED Requirements

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
