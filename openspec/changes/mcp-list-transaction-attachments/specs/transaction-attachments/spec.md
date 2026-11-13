## ADDED Requirements

### Requirement: Attachment metadata over MCP
The MCP server SHALL offer a read-only tool, `list_transaction_attachments`, that takes a transaction id and returns that transaction's attachments: id, name, type, size and created time. It SHALL NOT return a document's content, hash or encryption data, SHALL NOT attach, open or remove a document, and SHALL refuse an empty id. A line of a split SHALL give its parent's attachments, with the parent's id as `transaction_id`. Names are untrusted text.

#### Scenario: List a transaction's attachments
- **GIVEN** a transaction with a 200 KB PDF attached
- **WHEN** an agent calls `list_transaction_attachments` with the transaction's id
- **THEN** it gets one entry with the file's name, type, size and created time, and no document content

#### Scenario: No attachments
- **WHEN** an agent lists a transaction that has none, or whose attachments were removed
- **THEN** it gets an empty list

#### Scenario: Invalid input
- **WHEN** an agent calls the tool with an empty transaction id
- **THEN** the tool refuses and returns nothing

#### Scenario: Split line
- **GIVEN** a split transaction with a PDF attached to its parent
- **WHEN** an agent lists the attachments of one of its split lines
- **THEN** it gets the parent's PDF, with the parent's id as `transaction_id`
