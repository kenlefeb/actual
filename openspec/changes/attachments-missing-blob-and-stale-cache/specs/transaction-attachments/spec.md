## MODIFIED Requirements

### Requirement: Open a document
Opening an attachment SHALL fetch its document from the server, decrypt it if it's encrypted, and show it in the browser's own viewer in a new tab. A document once fetched SHALL be kept on the device, so it opens again without the server. A kept copy that no longer decrypts (another device changed the key) SHALL be dropped and the document fetched from the server once more.

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

#### Scenario: Key changed on another device
- **GIVEN** the user opened an encrypted attachment on this device, and then another device changed the encryption key and this device synced
- **WHEN** the user opens the attachment again
- **THEN** it opens with the same bytes that were attached

### Requirement: Changing the encryption key
When the user creates a new encryption key for a budget, every attachment encrypted with the old key SHALL be re-encrypted with the new key and stored again in place, before the key change completes, so no document becomes unreadable. Attachments marked unencrypted SHALL stay as they are. An attachment whose document the server no longer holds (not found) SHALL be skipped and its id logged, and SHALL NOT stop the key change. If any other re-encryption fails, the key change SHALL stop with an error, the old key SHALL stay in effect, and every attachment SHALL still open.

#### Scenario: New key keeps documents readable
- **GIVEN** a budget with an encryption key and an attached PDF
- **WHEN** the user creates a new encryption key and then opens the attachment, on this device and on another device signed in with the new key
- **THEN** the PDF opens on both

#### Scenario: Re-encryption fails
- **GIVEN** a budget with an encryption key and two attached PDFs
- **WHEN** the user creates a new key and the server refuses the second re-upload
- **THEN** the key change fails with a message, the old key stays in effect, and both PDFs open

#### Scenario: A document is gone from the server
- **GIVEN** a budget with an encryption key and two attached PDFs, and the server no longer holds the first PDF's document
- **WHEN** the user creates a new key
- **THEN** the key change succeeds, the first attachment's id is logged as skipped, and the second PDF opens with the new key
